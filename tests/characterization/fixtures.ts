/**
 * Shared steps of the characterization suite. Everything goes through HTTP, the way a
 * browser or a script would use DVinyl, and the instance backup is the oracle for what
 * got stored: its format has to survive any change of storage, so it judges the data
 * without depending on how the data is kept.
 */

import assert from 'node:assert/strict';
import { App } from './sandbox';
import { Client } from './client';

export const ADMIN = { username: 'admin', email: 'admin@example.test', password: 'Test1234*' };

/** Runs the first-install form, which signs the new admin in. */
export async function setupAdmin(app: App): Promise<Client> {
  const client = app.client();
  const reply = await client.postForm('/setup', { ...ADMIN, language: 'en' });
  assert.equal(reply.status, 302, `setup failed:\n${reply.text.slice(0, 500)}`);
  assert.equal(reply.location, '/');
  return client;
}

export async function login(app: App, email: string, password: string): Promise<Client> {
  const client = app.client();
  const reply = await client.postJson('/login', { email, password });
  assert.equal(reply.status, 200, `login of ${email} failed: ${reply.text.slice(0, 300)}`);
  return client;
}

/** Turns modules on in the active collection; every other module goes off. */
export async function enableModules(
  admin: Client,
  modules: string[],
  options: { mergeDuplicates?: boolean } = {}
): Promise<void> {
  const fields: Record<string, string> = {};
  for (const id of modules) fields[`${id}Active`] = 'on';
  if (options.mergeDuplicates !== false) fields.mergeDuplicates = 'on';
  const reply = await admin.postForm('/admin/modules/save', fields);
  assert.equal(reply.status, 302);
  assert.equal(reply.location, '/admin?msg=saved');
}

/** Submits an item form the way the manual add page does. */
export async function saveItem(
  client: Client,
  pluginId: string,
  fields: Record<string, string | number | boolean | string[]>
) {
  return client.postForm(`/save-${pluginId}`, {
    quantity: 1,
    in_wishlist: 'false',
    images_json: '[]',
    ...fields
  });
}

export async function addMusic(client: Client, fields: Record<string, string | number | string[]>) {
  const reply = await saveItem(client, 'music', { media_type: 'vinyl', tracklist_json: '[]', ...fields });
  assert.equal(reply.status, 302, `save-music failed (${reply.status}): ${reply.text.slice(0, 300)}`);
  return reply;
}

export interface InstanceDump {
  users: any[];
  albums: any[];
  settings: any[];
  collections: any[];
  furniture: any[];
  lists: any[];
  customPlugins: any[];
  priceHistory: any[];
  logs: any[];
  instanceSettings: any;
  metadata: any;
}

export async function exportInstance(admin: Client): Promise<InstanceDump> {
  const reply = await admin.get('/backup/export');
  assert.equal(reply.status, 200, `export failed: ${reply.text.slice(0, 300)}`);
  return reply.json();
}

export function itemByTitle(dump: InstanceDump, title: string): any {
  const matches = dump.albums.filter(item => item.title === title);
  assert.equal(matches.length, 1, `expected one item titled "${title}", found ${matches.length}`);
  return matches[0];
}

export function titles(dump: InstanceDump): string[] {
  return dump.albums.map(item => item.title).sort();
}

/** Item ids in the order a collection, wishlist or share page lists them. */
export function listedIds(html: string): string[] {
  return [...html.matchAll(/data-item-id="([0-9a-zA-Z_-]+)"/g)].map(match => match[1]!);
}

/** The titles a listing page shows, in page order, resolved through a dump. */
export function listedTitles(html: string, dump: InstanceDump): string[] {
  const byId = new Map(dump.albums.map(item => [String(item._id), item.title]));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of listedIds(html)) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(byId.get(id) ?? `<unknown ${id}>`);
  }
  return result;
}

/** The number shown in the item count badge of a collection or wishlist page. */
export function totalBadge(html: string): number {
  const match = html.match(/id="totalItemsBadge"[^>]*>\s*(\d+)/);
  assert.ok(match, 'no item count badge on the page');
  return Number(match[1]);
}

export function uniqueTitlesBadge(html: string): { count: number; hidden: boolean } {
  const match = html.match(/<span id="uniqueTitlesBadge"\s+class="([^"]*)"[^>]*>\s*([^<]*)</);
  assert.ok(match, 'no unique titles badge on the page');
  const count = Number((match[2]!.match(/\d+/) || ['NaN'])[0]);
  return { count, hidden: /(^|\s)hidden(\s|$)/.test(match[1]!) };
}

/**
 * A dump with what changes on every run taken out (ids, dates, hashes, version keys), so
 * two dumps of the same data compare equal. Ids become labels naming the document they
 * point at, which keeps references checkable: an item's `collection` reads
 * `collections:Vinyl` whatever the id.
 */
export function normalizeDump(dump: InstanceDump): any {
  const labels = new Map<string, string>();
  const label = (table: string, doc: any) =>
    `${table}:${doc.title ?? doc.name ?? doc.username ?? doc.key ?? doc.id ?? doc.slug ?? '?'}`;
  for (const [table, rows] of Object.entries(dump)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) if (row && row._id) labels.set(String(row._id), label(table, row));
  }

  const isId = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);
  const isDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);

  const walk = (value: any, key = ''): any => {
    if (Array.isArray(value)) return value.map(entry => walk(entry));
    if (value && typeof value === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === '__v') continue;
        // A storage may keep an absent value as null or an empty object, or drop it:
        // the three read the same to the app, so they compare the same here.
        if (v === null || v === undefined) continue;
        if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && Object.keys(v).length === 0) continue;
        out[k] = walk(v, k);
      }
      return out;
    }
    if (isId(value)) return labels.get(value) ?? (key === '_id' ? '<id>' : '<unknown id>');
    if (isDate(value)) return '<date>';
    if (key === 'password' && typeof value === 'string') return '<hash>';
    return value;
  };

  const { metadata, logs, ...rest } = dump;
  const normalized = walk(rest);
  for (const rows of Object.values(normalized)) {
    if (Array.isArray(rows)) rows.sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return normalized;
}

/** An instance with something in every table a backup carries. */
export async function seedEverything(app: App): Promise<Client> {
  const admin = await setupAdmin(app);
  await enableModules(admin, ['music', 'books']);
  await addMusic(admin, {
    title: 'The Wall', artist: 'Pink Floyd', year: '1979', genres: 'Rock', styles: 'Prog Rock',
    discogs_id: '1', location: 'Shelf A', barcode: '5099902894225', comments: 'Gatefold',
    tracklist_json: JSON.stringify([{ position: 'A1', title: 'In the Flesh?', duration: '3:16' }])
  });
  await addMusic(admin, { title: 'Abbey Road', artist: 'The Beatles', media_type: 'cd', genres: 'Rock' });
  await addMusic(admin, { title: 'Blue Train', artist: 'John Coltrane', in_wishlist: 'true' });
  const book = await saveItem(admin, 'books', { title: 'Dune', author: 'Frank Herbert', isbn: '9780441172719', format: 'paperback' });
  assert.equal(book.status, 302);

  let dump = await exportInstance(admin);
  const wall = itemByTitle(dump, 'The Wall');
  const list = (await admin.postJson('/lists', { name: 'Favourites' })).json().list;
  await admin.postJson(`/api/lists/${list.id}/add`, { items: [String(wall._id), String(itemByTitle(dump, 'Dune')._id)] });
  const mix = (await admin.postJson('/lists', { name: 'Mix', kind: 'tracks' })).json().list;
  await admin.postJson(`/api/lists/${mix.id}/add`, { item: String(wall._id), track: String(wall.tracklist[0]._id) });

  await admin.postForm('/admin/share/create', { label: 'Public' });
  await admin.postForm('/admin/visibility/save', { hiddenGenres: 'Jazz' });
  await admin.postForm('/admin/collections/create', { name: 'Comics' });
  dump = await exportInstance(admin);
  await admin.postForm('/collection/switch', { collectionId: String(dump.collections.find(c => c.name === 'Comics')._id) });
  await addMusic(admin, { title: 'Other Shelf', artist: 'Someone' });
  await admin.postForm('/collection/switch', { collectionId: String(dump.collections.find(c => c.name === 'Vinyl')._id) });
  return admin;
}
