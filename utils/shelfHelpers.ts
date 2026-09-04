// Bounds of a piece of furniture, enforced by the schema so neither a form post nor a
// restored backup can ask the view to draw a thousand-cell grid. Declared here rather
// than in the model so the model can import them without a cycle.
export const MAX_FURNITURE_COLUMNS = 12;
export const MAX_FURNITURE_ROWS = 12;

/**
 * Where things are kept has always been free text on the item, offered as a datalist
 * that suggests without constraining, and written by four paths that never see that
 * list at all (the edit form, the CSV importer, a backup restore, a Libib import).
 * "Salon", "salon" and "Salon " are therefore three different shelves as far as Mongo
 * is concerned, and they already show up as three entries in the location filter.
 *
 * This is the one reading of a shelf name. Two spellings that normalize alike are the
 * same shelf everywhere, which only holds as long as every write path goes through
 * here: skip it in one importer and the duplicates come straight back.
 */
export function locationKey(value: unknown): string {
  return normalizeLocationName(value).toLocaleLowerCase();
}

/**
 * The display form of a shelf name: what the user typed, minus the accidents. Casing
 * is deliberately kept, since it is the part a person chose.
 */
export function normalizeLocationName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * The spelling a shelf keeps when several of them turn out to be the same shelf. The
 * one used by the most items wins, on the grounds that it is the one that was typed
 * on purpose; ties are broken alphabetically so a re-run picks the same name.
 */
export function pickDisplayName(variants: { name: string; count: number }[]): string {
  const ordered = [...variants].sort((a, b) =>
    b.count - a.count || a.name.localeCompare(b.name)
  );
  const mostUsed = ordered[0];
  return mostUsed ? normalizeLocationName(mostUsed.name) : '';
}

/**
 * Rejects a set of cells that would leave a piece of furniture with the same shelf
 * twice. The unique index cannot catch this one: Mongo dedupes index keys within a
 * single document, so both copies live in the same array and pass.
 */
export function findDuplicateCellKey(cells: { key: string }[]): string | null {
  const seen = new Set<string>();
  for (const cell of cells) {
    if (seen.has(cell.key)) return cell.key;
    seen.add(cell.key);
  }
  return null;
}

/**
 * A grid that holds `cellCount` shelves: as square as it can be up to `maxColumns`,
 * then as many rows as that takes. Used to give seeded furniture a plausible shape,
 * and by the editor when it has to grow one.
 *
 * Never returns more than one piece of furniture's worth: a caller with more shelves
 * than `capacityPerFurniture()` allows has to split them.
 */
export function fitGrid(cellCount: number, maxColumns = 4): { columns: number; rows: number } {
  const columns = Math.min(
    Math.max(1, Math.min(maxColumns, MAX_FURNITURE_COLUMNS)),
    Math.max(1, cellCount)
  );
  const rows = Math.min(MAX_FURNITURE_ROWS, Math.max(1, Math.ceil(cellCount / columns)));
  return { columns, rows };
}

/** How many shelves one piece of furniture can hold at a given width. */
export function capacityPerFurniture(maxColumns = 4): number {
  const columns = Math.max(1, Math.min(maxColumns, MAX_FURNITURE_COLUMNS));
  return columns * MAX_FURNITURE_ROWS;
}
