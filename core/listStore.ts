import mongoose from 'mongoose';
import Item from '../models/Item';
import List from '../models/List';
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

const toId = (value: unknown) =>
  mongoose.Types.ObjectId.isValid(value as any) ? new mongoose.Types.ObjectId(String(value)) : null;

/** The list named by `id`, if it belongs to the given collection. */
export async function ownList(collectionId: any, id: unknown) {
  const listId = toId(id);
  if (!listId) return null;
  return List.findOne({ _id: listId, collection: collectionId });
}

/** Whether any enabled plugin keeps a tracklist, which is what a playlist is made from. */
export function pluginsWithTracks(settings: any) {
  return registry.getEnabled(settings).filter(p => !!(p.schemaDefinition as any)?.tracklist);
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
 */
export async function resolveListEntries(list: any, collectionId: any): Promise<(ResolvedItemEntry | ResolvedTrackEntry)[]> {
  const entries: any[] = list.entries || [];
  if (entries.length === 0) return [];

  const itemIds = [...new Set(entries.map(e => String(e.item)))];
  const items = await Item.find({ _id: { $in: itemIds }, collection: collectionId }).lean();
  const byId = new Map(items.map((item: any) => [String(item._id), item]));

  const resolved: (ResolvedItemEntry | ResolvedTrackEntry)[] = [];
  const dangling: any[] = [];

  for (const entry of entries) {
    const raw: any = byId.get(String(entry.item));
    const plugin = raw ? registry.getByKind(raw.kind) : null;
    if (!raw || !plugin) {
      dangling.push(entry._id);
      continue;
    }

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
    await List.updateOne({ _id: list._id }, { $pull: { entries: { _id: { $in: dangling } } } });
  }
  return resolved;
}

/** Takes deleted items out of every list that held them, tracks included. */
export async function pullItemsFromLists(itemIds: any[]): Promise<void> {
  if (!itemIds || itemIds.length === 0) return;
  await List.updateMany(
    { 'entries.item': { $in: itemIds } },
    { $pull: { entries: { item: { $in: itemIds } } } }
  );
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

  const items = await Item.find({ _id: { $in: allIds }, collection: collectionId }).lean();
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
