import { PluginDefinition, FieldDefinition } from './types';
import { parseGenresAndStyles } from './helpers';
import { imagesFromJson } from './itemImages';
import { DEFAULT_PLACEHOLDER_IMAGE } from './placeholderImage';

const CORE_FIELDS = new Set([
  'title', 'year', 'cover_image', 'user_image', 'images', 'in_wishlist', 'comments',
  'location', 'quantity', 'barcode', 'barcode_locked', 'added_at', 'genres', 'styles', 'genre'
]);

/**
 * Builds a Mongoose-ready update object from a JSON /api/v1 request body, the same
 * shape core/routes/itemRoutes.ts's save handler builds from a form post — minus the
 * multipart-specific parsing ('on'/'true' strings, images_json), since the API body
 * already carries real JSON types. Shared by item creation (Task 4) and item edit
 * (Task 5) so this logic exists in exactly one place.
 *
 * `partial: true` (edit/PATCH) only emits keys the body actually carries, so omitted
 * fields keep their stored values instead of being reset to the builder's defaults.
 * A create sends the whole form and uses the defaults.
 */
export function buildApiItemUpdateData(
  plugin: PluginDefinition,
  body: Record<string, any>,
  extraFieldDefs: FieldDefinition[],
  options?: { partial?: boolean }
): Record<string, any> {
  const partial = options?.partial === true;
  const has = (key: string) => !partial || Object.prototype.hasOwnProperty.call(body, key);

  const { genres: parsedGenres, styles: parsedStyles } = parseGenresAndStyles(body.genres, body.styles);

  // A cover left untouched posts back whatever the form displayed, i.e. the resolved
  // placeholder. Storing it would freeze a copy of the plugin's default image on the
  // item; kept empty instead, so the item follows that default if it ever changes.
  const placeholder = plugin.placeholderImage || DEFAULT_PLACEHOLDER_IMAGE;
  const submittedImages = imagesFromJson(body).filter(image =>
    image !== placeholder && image !== DEFAULT_PLACEHOLDER_IMAGE
  );
  const coverImage = submittedImages[0] || '';
  const secondaryImage = submittedImages[1] || '';

  const updateData: Record<string, any> = {};

  if (has('title')) updateData.title = body.title;
  if (has('year')) updateData.year = body.year;
  if (has('images')) {
    updateData.cover_image = coverImage;
    updateData.user_image = secondaryImage;
    updateData.images = submittedImages;
  }
  if (has('in_wishlist')) updateData.in_wishlist = body.in_wishlist === true;
  if (has('comments')) updateData.comments = body.comments || '';
  if (has('location')) updateData.location = body.location || '';
  if (has('quantity')) updateData.quantity = parseInt(body.quantity, 10) || 1;
  if (has('genre')) updateData.genre = body.genre || (parsedGenres.length > 0 ? parsedGenres[0] : '');
  if (has('genres')) updateData.genres = parsedGenres;
  if (has('styles')) updateData.styles = parsedStyles;
  if (has('barcode')) updateData.barcode = body.barcode || '';
  if (has('barcode_locked')) updateData.barcode_locked = body.barcode_locked === true;
  if (has('added_at')) updateData.added_at = body.added_at ? new Date(body.added_at) : new Date();
  updateData.kind = plugin.kind;

  const extraValues: Record<string, any> = {};
  for (const field of [...plugin.formFields, ...extraFieldDefs]) {
    if (CORE_FIELDS.has(field.name)) continue;
    // In a partial update an omitted field must be left alone, not reset to its
    // type's zero value (a boolean would otherwise become false, a date null).
    if (partial && !Object.prototype.hasOwnProperty.call(body, field.name)) continue;

    let value = body[field.name];
    if (field.type === 'number') {
      value = value !== undefined && value !== null && value !== '' ? Number(value) : undefined;
    } else if (field.type === 'date') {
      const raw = typeof value === 'string' ? value.trim() : value;
      const parsed = !raw ? null : new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw);
      value = parsed && !isNaN(parsed.getTime()) ? parsed : null;
    } else if (field.type === 'boolean') {
      value = value === true;
    } else if (field.type === 'tags' && typeof value === 'string' && field.extraField) {
      value = value.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    if (value !== undefined) {
      if (field.extraField) {
        extraValues[field.name] = value;
      } else {
        updateData[field.name] = value;
      }
    }
  }

  if (Object.keys(extraValues).length > 0) {
    updateData.extra = extraValues;
  }

  for (const key of Object.keys(plugin.schemaDefinition)) {
    if (updateData[key] === undefined && body[key] !== undefined && body[key] !== '') {
      updateData[key] = body[key];
    }
  }

  if (typeof plugin.normalizeForSave === 'function') {
    plugin.normalizeForSave(updateData);
  }

  return updateData;
}
