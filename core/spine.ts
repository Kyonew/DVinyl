import { PluginDefinition, SpineShape } from './types';

export interface SpineSize {
  // Millimetres of shelf an item takes up standing on its spine.
  thickness: number;
  // Millimetres tall, standing.
  height: number;
  shape?: SpineShape;
}

// What a format nobody described is drawn as: a case of about DVD proportions.
export const SPINE_FALLBACK: SpineSize = { thickness: 12, height: 190 };

// The thinnest real format on a shelf, and the width it is drawn at. 20px is what a
// single line of vertical 11px type needs with its padding, so this is the floor below
// which a spine can no longer carry its own name.
const SPINE_MIN_PX = 20;
const THINNEST_MM = 3;

// Deliberately nowhere near true scale (0.7px per mm, against the ~0.57 the heights
// use). Real proportions would draw a DVD four times the width of a vinyl sleeve, a
// row of cupboard doors; compressed, a DVD still reads as visibly fatter without
// taking the plank over. Order is what survives: the thinnest stays the thinnest.
const MM_TO_PX = 0.7;

// Drawing height of the tallest format standing in a piece of furniture. Everything
// shorter is scaled against it, which is where the shelf gets its shape from.
export const SPINE_MAX_HEIGHT_PX = 180;

// How many tints the shelf palette holds. The colours themselves live with the view
// (views/partials/shelf-view.ejs), once per theme mode; only the index is decided here.
export const SPINE_TONES = 12;

/**
 * Which tint of the shelf palette a spine is painted in. Read from the title alone, so
 * an item keeps its colour from one visit to the next and the LP and the CD of the same
 * album stand out as a pair, without reading a single pixel of a cover: covers are often
 * remote URLs, and sampling them would cost a fetch and an image library per spine.
 */
export function spineTone(title: unknown): number {
  const text = String(title || '').trim().toLowerCase();
  // FNV-1a: short, stable across runs and Node versions, and spreads close titles apart.
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % SPINE_TONES;
}

export function spineWidth(thicknessMm: number): number {
  return Math.round(SPINE_MIN_PX + Math.max(0, thicknessMm - THINNEST_MM) * MM_TO_PX);
}

/**
 * The format value an item carries. Plugins disagree on the field it lives in (music
 * says `media_type`, everyone else says `format`), so this follows the same reading as
 * the cards in views/partials/cover-badge.ejs.
 */
export function formatOf(item: any): string {
  return String(item?.format || item?.media_type || '').toLowerCase();
}

export function sizeForItem(item: any, plugin?: PluginDefinition): SpineSize {
  return plugin?.spineSize?.[formatOf(item)] || SPINE_FALLBACK;
}

/**
 * The height, in millimetres, that fills a compartment: the tallest format any of the
 * collection's own types can hold.
 *
 * Deliberately not "the tallest item currently on screen". That reading looked right
 * until a filter was applied: narrowing the shelf to CDs left the CDs as the tallest
 * thing present, so they were drawn the full height of an LP and the shelf changed
 * shape under the filter. Taken from what the collection could hold, one shelf reads
 * the same whatever is being looked at.
 */
export function tallestFormat(plugins: PluginDefinition[]): number {
  const heights = plugins.flatMap(plugin => Object.values(plugin.spineSize || {}).map(size => size.height));
  return Math.max(SPINE_FALLBACK.height, ...heights);
}

/**
 * Measures a set of items into drawable spines, in place on the view objects, against
 * the reference height above. One reading for the whole piece of furniture: a CD is
 * 40% of the height of an LP wherever it is shelved, rather than filling whichever
 * compartment it happens to sit in.
 */
export function measureSpines(
  items: any[],
  pluginFor: (item: any) => PluginDefinition | undefined,
  referenceHeightMm: number
): void {
  const reference = referenceHeightMm > 0 ? referenceHeightMm : SPINE_FALLBACK.height;

  for (const item of items) {
    const size = sizeForItem(item, pluginFor(item));
    item.spine = {
      width: spineWidth(size.thickness),
      shape: size.shape || 'plain',
      tone: spineTone(item.title),
      // Floored so a format declared very short still has room for its own name.
      height: Math.max(48, Math.round(SPINE_MAX_HEIGHT_PX * Math.min(size.height, reference) / reference))
    };
  }
}

/**
 * How one compartment's items stand: upright in the page's order, except that what
 * goes past the compartment's capacity is laid flat in a pile at the end of the board,
 * the way an overfull shelf ends up in a real room.
 *
 * The pile only takes what it can hold without rising above the tallest spine, measured
 * on the drawn thicknesses: five LP sleeves make a pile, five boxed games make a tower.
 * Anything past that keeps standing, and the board scrolls instead.
 *
 * `lean` asks for the last upright item to rest against its neighbour, which only reads
 * right where there is room for it to tip: a compartment not yet full, with no pile to
 * hold things up. A compartment without a capacity has no notion of full, so it leans.
 */
export function arrangeCompartment<T extends { spine: { width: number } }>(items: T[], capacity: number) {
  const overflow = capacity > 0 ? Math.max(0, items.length - capacity) : 0;

  const pile: T[] = [];
  let stacked = 0;
  for (const item of items.slice(items.length - overflow).reverse()) {
    if (stacked + item.spine.width > SPINE_MAX_HEIGHT_PX) break;
    stacked += item.spine.width;
    pile.unshift(item);
  }

  const standing = items.slice(0, items.length - pile.length);
  const lean = pile.length === 0 && standing.length > 1 && (capacity <= 0 || standing.length < capacity);
  return { standing, pile, lean };
}

/**
 * Items standing nowhere, laid in piles the way things waiting to be put away are: one
 * kind of object per pile, each pile no taller than the tallest spine. Piles come in
 * the order their first item appears, so the page's sort still reads from left to right.
 */
export function pileUp<T extends { spine: { width: number } }>(items: T[], groupOf: (item: T) => string): T[][] {
  const open = new Map<string, { items: T[]; height: number }>();
  const piles: { items: T[]; height: number }[] = [];

  for (const item of items) {
    const group = groupOf(item);
    let pile = open.get(group);
    if (!pile || pile.height + item.spine.width > SPINE_MAX_HEIGHT_PX) {
      pile = { items: [], height: 0 };
      open.set(group, pile);
      piles.push(pile);
    }
    pile.items.push(item);
    pile.height += item.spine.width;
  }

  return piles.map(pile => pile.items);
}
