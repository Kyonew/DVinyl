import { PluginDefinition } from './types';

/**
 * The one place the `sort` vocabulary shared by the collection page and the API is mapped
 * onto a Mongo sort object. It covers the built-in keys every listing offers (`added`,
 * `title`, `year`), `artist` (the selected type's creator field) and the entries a plugin
 * declares for itself in `PluginDefinition.sortOptions` (books order by series).
 *
 * The value is the menu key and direction joined by an underscore - `added_desc`,
 * `title_asc`, `series_desc` - which is exactly what the page's sort controls send.
 *
 * Returns null when the value is absent, malformed, or names an option the given plugin
 * does not declare. The caller owns that case: the page treats it as the default order,
 * while the API answers 400 rather than silently returning a different one. `artist`
 * without a plugin is the same kind of miss - there is no creator field to name unless a
 * type is selected - unless the caller opts into the page's title fallback.
 *
 * User-defined (`xf:`) options belong to the collection, not the type, and are resolved by
 * the page before it gets here (see parseExtraSort); this is the type-shaped skeleton both
 * surfaces agree on, not the page's whole menu.
 */
export function resolveItemSort(
  sort: string | undefined | null,
  plugin?: PluginDefinition,
  opts: { artistFallbackToTitle?: boolean } = {}
): Record<string, 1 | -1> | null {
  if (typeof sort !== 'string') return null;
  const match = sort.match(/^(.*)_(asc|desc)$/);
  if (!match) return null;
  const key = match[1]!;
  const dir: 1 | -1 = match[2] === 'asc' ? 1 : -1;

  if (key === 'added') return { added_at: dir };
  if (key === 'title') return { sort_title: dir, title: dir };
  if (key === 'year') return { year: dir };
  if (key === 'artist') {
    // A page spans every type while nothing is selected, and has always fallen back to
    // the title there; the API would rather say the key is unknown than answer a
    // question it was not asked. Hence the opt-in rather than a built-in fallback.
    if (!plugin) return opts.artistFallbackToTitle ? { sort_title: dir, title: dir } : null;
    return { [plugin.creatorField]: dir };
  }

  const option = plugin?.sortOptions?.find(o => o.key === key);
  if (!option) return null;

  // Sort on the option's own fields in order, then on the title, so two items whose keys
  // are equal ("The Wall" and "Wall") do not come back in whatever order Mongo felt like.
  const resolved: Record<string, 1 | -1> = {};
  for (const field of option.fields) resolved[field] = dir;
  return { ...resolved, sort_title: dir, title: dir };
}
