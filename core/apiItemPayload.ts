import { PluginDefinition, FieldDefinition } from './types';
import { parseGenresAndStyles } from './helpers';
import { imagesFromJson } from './itemImages';

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
 */
export function buildApiItemUpdateData(
  plugin: PluginDefinition,
  body: Record<string, any>,
  extraFieldDefs: FieldDefinition[]
): Record<string, any> {
  const { genres: parsedGenres, styles: parsedStyles } = parseGenresAndStyles(body.genres, body.styles);
  const submittedImages = imagesFromJson(body);
  const coverImage = submittedImages[0] || '';
  const secondaryImage = submittedImages[1] || '';

  const updateData: Record<string, any> = {
    title: body.title,
    year: body.year,
    cover_image: coverImage,
    user_image: secondaryImage,
    images: submittedImages,
    in_wishlist: body.in_wishlist === true,
    comments: body.comments || '',
    location: body.location || '',
    quantity: parseInt(body.quantity, 10) || 1,
    genre: body.genre || (parsedGenres.length > 0 ? parsedGenres[0] : ''),
    genres: parsedGenres,
    styles: parsedStyles,
    barcode: body.barcode || '',
    barcode_locked: body.barcode_locked === true,
    added_at: body.added_at ? new Date(body.added_at) : new Date(),
    kind: plugin.kind
  };

  const extraValues: Record<string, any> = {};
  for (const field of [...plugin.formFields, ...extraFieldDefs]) {
    if (CORE_FIELDS.has(field.name)) continue;

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
