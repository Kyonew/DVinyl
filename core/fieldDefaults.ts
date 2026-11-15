import { FieldDefinition } from './types';

/**
 * Default values of the fields an admin creates, in a custom plugin or added to any
 * plugin. A new item's form starts on them; the person adding it is free to change or
 * clear them. Nothing already saved is touched: an empty field on an existing item stays
 * empty, since it may have been emptied on purpose.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What the builder may store as the default of a field of `type`, from what the admin
 * typed. `undefined` means no default: left blank, not readable for the type, or a type
 * that takes none (a list of rows has nothing sensible to start from).
 */
export function sanitizeFieldDefault(
  type: string,
  raw: any,
  options: { value: string; label: string }[] = []
): any {
  if (raw === undefined || raw === null) return undefined;
  if (type === 'boolean') return raw === true || raw === 'true' || raw === 'on' ? true : undefined;
  const text = String(raw).trim();
  if (!text) return undefined;

  switch (type) {
    case 'text':
      return text.slice(0, 200);
    case 'textarea':
      return text.slice(0, 2000);
    case 'number': {
      const n = Number(text.replace(',', '.'));
      return Number.isFinite(n) ? n : undefined;
    }
    case 'date': {
      if (!DATE_RE.test(text)) return undefined;
      return Number.isNaN(new Date(`${text}T00:00:00Z`).getTime()) ? undefined : text;
    }
    case 'tags': {
      const tags = [...new Set(text.split(',').map(s => s.trim().slice(0, 60)).filter(Boolean))].slice(0, 20);
      return tags.length > 0 ? tags : undefined;
    }
    case 'select': {
      // The admin types one of the choices as they wrote it; the stored value is its key.
      const wanted = text.toLowerCase();
      const option = options.find(o => o.value.toLowerCase() === wanted || o.label.toLowerCase() === wanted);
      return option ? option.value : undefined;
    }
    default:
      return undefined;
  }
}

function isEmpty(value: any): boolean {
  return value === undefined || value === null || value === '' || value === false
    || (Array.isArray(value) && value.length === 0);
}

/**
 * The form values of a new item with every empty field added to a plugin (extraField)
 * that has a default filled in. A custom plugin's own fields start on theirs through its
 * getManualDefaults, and a native plugin's are its own business.
 * `false` counts as empty since the only default a checkbox takes is "ticked".
 */
export function withFieldDefaults(fields: FieldDefinition[], item: Record<string, any>): Record<string, any> {
  const out = { ...item };
  for (const field of fields) {
    if (!field.extraField || field.default === undefined || isEmpty(field.default)) continue;
    if (!isEmpty(out[field.name])) continue;
    out[field.name] = Array.isArray(field.default) ? [...field.default] : field.default;
  }
  return out;
}
