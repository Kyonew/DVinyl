import { PluginDefinition } from './types';

export interface SpineSize {
  // Millimetres of shelf an item takes up standing on its spine.
  thickness: number;
  // Millimetres tall, standing.
  height: number;
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
      // Floored so a format declared very short still has room for its own name.
      height: Math.max(48, Math.round(SPINE_MAX_HEIGHT_PX * Math.min(size.height, reference) / reference))
    };
  }
}
