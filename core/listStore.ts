import { db } from './db';
import { and, eq, idOf, isId, isIn } from './db/query';
import { registry } from './registry';

export const LIST_KINDS = ['items', 'tracks'] as const;
export type ListKind = typeof LIST_KINDS[number];

// Long enough for "Played in 2026, to finish", short enough to stay readable on a card.
export const MAX_LIST_NAME = 60;
export const MAX_LIST_DESCRIPTION = 500;
// A list is read whole on every visit, and a line is one item looked up: past a few
// thousand it stops being a list anyone reads top to bottom.
export const MAX_LIST_ENTRIES = 2000;
// How many items one bulk add may carry, same bound as the other bulk actions.
export const MAX_LIST_BULK_ADD = 500;

export function isListKind(value: unknown): value is ListKind {
  return typeof value === 'string' && (LIST_KINDS as readonly string[]).includes(value);
}

export function cleanListName(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LIST_NAME);
}

export function cleanListDescription(value: unknown): string {
  return String(value ?? '').trim().slice(0, MAX_LIST_DESCRIPTION);
}

/** The list named by `id`, if it belongs to the given collection. */
export async function ownList(collectionId: any, id: unknown): Promise<any | null> {
  const listId = idOf(id);
  if (!isId(listId)) return null;
  return db.lists.findOne(and(eq('_id', listId), eq('collection', idOf(collectionId))), { defaults: true });
}

/** Whether any enabled plugin keeps a tracklist, which is what a playlist is made from. */
export function pluginsWithTracks(settings: any) {
  return registry.getEnabled(settings).filter(p => p.storedFields?.tracklist?.type === 'records');
}

export type ResolvedItemEntry = {
  entryId: string;
  item: any;
  plugin: any;
  cover: string;
  creator: string;
};

export type ResolvedTrackEntry = ResolvedItemEntry & {
  track: any;
};

/**
 * The lines of a list, read against what the collection holds today. An entry whose
 * item was deleted, or whose track was edited out of its item, has nothing left to show:
 * it is dropped here and removed from the list, so the next visit does not look again.
 * Only a missing item or track counts: anything else is skipped and kept.
 */
export async function resolveListEntries(list: any, collectionId: any): Promise<(ResolvedItemEntry | ResolvedTrackEntry)[]> {
  const entries: any[] = list.entries || [];
  if (entries.length === 0) return [];

  const itemIds = [...new Set(entries.map(e => String(e.item)))];
  const items = await db.items.find(and(isIn('_id', itemIds), eq('collection', idOf(collectionId))));
  const byId = new Map(items.map((item: any) => [String(item._id), item]));

  const resolved: (ResolvedItemEntry | ResolvedTrackEntry)[] = [];
  const dangling: any[] = [];

  for (const entry of entries) {
    const raw: any = byId.get(String(entry.item));
    if (!raw) {
      dangling.push(entry._id);
      continue;
    }
    // An item whose plugin is not loaded right now (a custom one being rebuilt, a folder
    // that failed at boot) still exists: it is left out of this reading, not the list.
    const plugin = registry.getByKind(raw.kind);
    if (!plugin) continue;

    let track: any = null;
    if (list.kind === 'tracks') {
      track = (raw.tracklist || []).find((t: any) => String(t._id) === String(entry.track));
      if (!track) {
        dangling.push(entry._id);
        continue;
      }
    }

    const view = plugin.formatForView(raw);
    const line: any = {
      entryId: String(entry._id),
      item: view,
      plugin,
      cover: view.cover_image || '',
      creator: plugin.creatorField ? String(raw[plugin.creatorField] || '') : ''
    };
    if (track) line.track = track;
    resolved.push(line);
  }

  if (dangling.length > 0) {
    await db.lists.updateOne(eq('_id', idOf(list._id)), { pull: { entries: isIn('_id', dangling.map(idOf)) } });
  }
  return resolved;
}

/** Takes deleted items out of every list that held them, tracks included. */
export async function pullItemsFromLists(itemIds: any[]): Promise<void> {
  if (!itemIds || itemIds.length === 0) return;
  const ids = itemIds.map(idOf);
  await db.lists.updateMany(isIn('entries.item', ids), { pull: { entries: isIn('item', ids) } });
}

/**
 * Up to four covers per list, for the cards of the list page. Read in one query for
 * every list on the page rather than one per card.
 */
export async function listCovers(lists: any[], collectionId: any): Promise<Map<string, string[]>> {
  const wanted = new Map<string, string[]>();
  for (const list of lists) {
    const ids = [...new Set((list.entries || []).map((e: any) => String(e.item)))].slice(0, 4) as string[];
    wanted.set(String(list._id), ids);
  }
  const allIds = [...new Set([...wanted.values()].flat())];
  if (allIds.length === 0) return new Map();

  const items = await db.items.find(and(isIn('_id', allIds), eq('collection', idOf(collectionId))));
  const coverById = new Map<string, string>();
  for (const raw of items as any[]) {
    const plugin = registry.getByKind(raw.kind);
    const view = plugin ? plugin.formatForView(raw) : raw;
    if (view.cover_image) coverById.set(String(raw._id), view.cover_image);
  }

  const out = new Map<string, string[]>();
  for (const [listId, ids] of wanted) {
    out.set(listId, ids.map(id => coverById.get(id)).filter(Boolean) as string[]);
  }
  return out;
}
