/**
 * The MongoDB aggregation key that counts distinct works (see countDistinctWorks in
 * core/db/items.ts).
 */

import type { CreatorFieldSource } from '../../helpers';

// Folds a creator value to the same shape across editions: lowercased and trimmed.
// Matches the case/space-insensitive intent of each plugin's getVariants(), which
// compares title and creator with an `^...$`/`i` regex.
//
// Anything that is not a string (missing, null, or a number or array left by a native
// backup insert that skipped the schema cast) stands in as "". $trim throws on a
// non-string input, and one such item would otherwise fail the whole aggregate.
function normalizeCreatorExpr(creatorExpr: any): any {
  return {
    $let: {
      vars: { c: creatorExpr },
      in: {
        $cond: [
          { $eq: [{ $type: '$$c' }, 'string'] },
          { $toLower: { $trim: { input: '$$c' } } },
          ''
        ]
      }
    }
  };
}

// The $switch case picking one plugin's items. The plugin claiming the pre-plugins stock
// (matchesLegacyItems) also takes the items with no `kind` at all, as the shelf query
// does, so they key on its creator field instead of falling to the title-only default.
function kindCaseExpr(plugin: CreatorFieldSource): any {
  const own = { $eq: ['$kind', plugin.kind] };
  return plugin.matchesLegacyItems
    ? { $or: [own, { $eq: [{ $type: '$kind' }, 'missing'] }] }
    : own;
}

/**
 * Builds the `$group._id` expression that counts distinct works behind the raw item
 * count on the collection shelf: editions of one work (several formats, a reissue) fold
 * together, while a remake stays apart through its different creator.
 *
 * The key is the normalized title plus the normalized creator. The title component uses
 * `sort_title` (already lowercased, accent-folded and article-stripped by
 * buildSortTitle), guarded with $ifNull so a legacy doc missing it still groups.
 *
 * The creator component depends on the view:
 * - A selected type names one creator field (artist, director, author...), so the key
 *   reads that field directly.
 * - The all-types view has no single creator field, so the component is a $switch on
 *   `kind` with one branch per enabled plugin (`then: '$' + creatorField`), driven by
 *   the registry so custom plugins are covered too, and a '' default for any unknown
 *   kind. This keeps the all-types number equal to the sum of the per-type counts: two
 *   different-type items sharing a title do not collapse, because their kinds pick
 *   different creator fields.
 *
 * The creator is normalized (see normalizeCreatorExpr), so "The Beatles", "the beatles"
 * and a trailing-space variant fold into one.
 */
export function buildUniqueTitlesGroupKey(
  selectedPlugin: CreatorFieldSource | undefined,
  enabledPlugins: CreatorFieldSource[]
): { title: any; creator: any } {
  const creatorExpr = selectedPlugin
    ? `$${selectedPlugin.creatorField}`
    : {
        $switch: {
          branches: enabledPlugins.map(p => ({
            case: kindCaseExpr(p),
            then: `$${p.creatorField}`
          })),
          default: ''
        }
      };

  return {
    title: { $ifNull: ['$sort_title', ''] },
    creator: normalizeCreatorExpr(creatorExpr)
  };
}
