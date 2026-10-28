import { db } from './db';
import { and, asc, eq, idOf } from './db/query';
import { cleanText, slugify } from './customPluginStore';
import type { RequestTemplate } from './types';

/**
 * The request types of a collection, made up by its admin from the admin page. A
 * collection starts with none; a loan or a gift is only a type built from one of the
 * templates below, which the admin can change like any other.
 */

export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'boolean'] as const;
export type FieldType = typeof FIELD_TYPES[number];
export type TypeField = { key: string; label: string; type: FieldType; required?: boolean; options?: string[]; deadline?: boolean };
export type TypeStep = { key: string; label: string; out?: boolean };

// The icons a request type can wear, picked from a grid in the builder: nobody has to know
// an icon's name. Anything else sent is replaced by the first.
export const REQUEST_TYPE_ICONS = [
  'paper-plane', 'hand-holding', 'gift', 'heart', 'star', 'bookmark', 'handshake', 'right-left',
  'headphones', 'music', 'compact-disc', 'record-vinyl', 'book-open', 'film', 'tv', 'gamepad',
  'dice', 'puzzle-piece', 'cubes', 'calendar-days', 'clock', 'house', 'truck', 'box',
  'broom', 'wrench', 'screwdriver-wrench', 'camera', 'magnifying-glass', 'comment', 'bell', 'tag',
  'cake-candles', 'champagne-glasses', 'mug-hot', 'ticket'
] as const;

export const MAX_TYPES = 30;
export const MAX_TYPE_FIELDS = 10;
export const MAX_TYPE_STEPS = 8;
const MAX_LABEL = 60;
const MAX_DESCRIPTION = 300;
const MAX_OPTIONS = 30;
const KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;

/** A key no other entry of `used` has, from what was given or from the label. */
function keyFor(given: unknown, label: string, used: Set<string>, fallback: string): string {
  let key = KEY_RE.test(String(given || '')) ? String(given) : slugify(label).replace(/-/g, '_');
  if (!KEY_RE.test(key)) key = `${fallback}_${key}`.replace(/[^a-z0-9_]/g, '').slice(0, 30);
  let unique = key;
  for (let n = 2; used.has(unique); n++) unique = `${key.slice(0, 27)}_${n}`;
  used.add(unique);
  return unique;
}

/**
 * A builder submission checked and put in shape. Keys already given (an edit) are kept,
 * so the answers and the step of earlier requests still line up.
 */
export function cleanRequestType(raw: any): { type: Record<string, any> | null; errors: string[] } {
  const errors: string[] = [];
  const name = cleanText(raw?.name, MAX_LABEL);
  if (!name) errors.push('requests.builder.err_name');

  const fields: TypeField[] = [];
  const fieldKeys = new Set<string>();
  const rawFields = Array.isArray(raw?.fields) ? raw.fields : [];
  if (rawFields.length > MAX_TYPE_FIELDS) errors.push('requests.builder.err_too_many_fields');
  for (const f of rawFields.slice(0, MAX_TYPE_FIELDS)) {
    const label = cleanText(f?.label, MAX_LABEL);
    if (!label) { errors.push('requests.builder.err_field_label'); continue; }
    const type: FieldType = (FIELD_TYPES as readonly string[]).includes(f?.type) ? f.type : 'text';
    const field: TypeField = { key: keyFor(f?.key, label, fieldKeys, 'field'), label, type, required: f?.required === true };
    if (type === 'select') {
      const source = Array.isArray(f?.options) ? f.options : String(f?.options || '').split('\n');
      field.options = [...new Set(source.map((o: any) => cleanText(o, MAX_LABEL)).filter(Boolean))].slice(0, MAX_OPTIONS) as string[];
      if (field.options.length === 0) errors.push('requests.builder.err_options');
    }
    if (type === 'date' && f?.deadline === true) field.deadline = true;
    fields.push(field);
  }
  // One due date per type: a second would leave "late" meaning nothing in particular.
  if (fields.filter(f => f.deadline).length > 1) errors.push('requests.builder.err_one_deadline');

  const steps: TypeStep[] = [];
  const stepKeys = new Set<string>();
  const rawSteps = Array.isArray(raw?.steps) ? raw.steps : [];
  if (rawSteps.length > MAX_TYPE_STEPS) errors.push('requests.builder.err_too_many_steps');
  for (const s of rawSteps.slice(0, MAX_TYPE_STEPS)) {
    const label = cleanText(s?.label, MAX_LABEL);
    if (!label) { errors.push('requests.builder.err_step_label'); continue; }
    steps.push({ key: keyFor(s?.key, label, stepKeys, 'step'), label, out: s?.out === true });
  }

  const holder = ['sender', 'recipient'].includes(raw?.holder) ? raw.holder : 'none';
  if (holder === 'none') steps.forEach(s => { s.out = false; });
  else if (!steps.some(s => s.out)) errors.push('requests.builder.err_holder_step');
  // The last step closes the request: an item still marked away there would never come back.
  if (steps.length > 0 && steps[steps.length - 1]!.out) errors.push('requests.builder.err_last_step_out');

  if (errors.length > 0) return { type: null, errors: [...new Set(errors)] };
  return {
    type: {
      name,
      icon: (REQUEST_TYPE_ICONS as readonly string[]).includes(String(raw?.icon)) ? String(raw.icon) : REQUEST_TYPE_ICONS[0],
      description: cleanText(raw?.description, MAX_DESCRIPTION),
      enabled: raw?.enabled !== false,
      minRole: ['editor', 'admin'].includes(raw?.minRole) ? raw.minRole : 'viewer',
      visibility: raw?.visibility === 'private' ? 'private' : 'members',
      holder,
      fields,
      steps
    },
    errors
  };
}

// The core's own starting points, offered whatever plugins are on.
const CORE_TEMPLATES: RequestTemplate[] = [
  {
    id: 'loan',
    name: 'requests.templates.loan.name',
    icon: 'hand-holding',
    description: 'requests.templates.loan.description',
    minRole: 'viewer',
    visibility: 'members',
    holder: 'sender',
    fields: [{ label: 'requests.templates.loan.due', type: 'date', required: false, deadline: true }],
    steps: [
      { label: 'requests.templates.loan.step_out', out: true },
      { label: 'requests.templates.loan.step_back', out: false }
    ]
  },
  {
    id: 'gift',
    name: 'requests.templates.gift.name',
    icon: 'gift',
    description: 'requests.templates.gift.description',
    minRole: 'viewer',
    visibility: 'private',
    holder: 'none',
    fields: [],
    steps: [{ label: 'requests.templates.gift.step_given', out: false }]
  }
];

/**
 * Ready-made starting points for the builder: the core's, then those of the plugins
 * that are on, worded in the admin's language. A word that is no key reads as written.
 * Nothing is created from them until the admin saves the form they fill in.
 */
export function requestTemplates(t: (k: string, options?: any) => string, plugins: { id: string; requestTemplates?: RequestTemplate[] }[] = []) {
  const word = (text: unknown) => {
    const value = String(text || '');
    return value ? t(value, { defaultValue: value }) : '';
  };
  const worded = (template: RequestTemplate) => ({
    name: word(template.name),
    icon: (REQUEST_TYPE_ICONS as readonly string[]).includes(template.icon) ? template.icon : REQUEST_TYPE_ICONS[0],
    description: word(template.description),
    minRole: template.minRole || 'viewer',
    visibility: template.visibility || 'members',
    holder: template.holder || 'none',
    fields: (template.fields || []).map(f => ({ ...f, label: word(f.label), options: f.options?.map(word) })),
    steps: (template.steps || []).map(s => ({ ...s, label: word(s.label) }))
  });
  const templates: Record<string, ReturnType<typeof worded>> = {};
  for (const template of CORE_TEMPLATES) templates[template.id] = worded(template);
  for (const plugin of plugins) {
    for (const template of plugin.requestTemplates || []) {
      if (template?.id && template.name) templates[`${plugin.id}.${template.id}`] = worded(template);
    }
  }
  return templates;
}

/** A slug no type of the collection has had, while requests may still carry it. */
export async function freeSlug(collectionId: any, name: string): Promise<string> {
  const base = slugify(name) || 'request';
  const taken = new Set([
    ...(await db.requestTypes.find(eq('collection', idOf(collectionId)), { fields: ['slug'] })).map((t: any) => t.slug),
    ...(await db.requests.distinct('type', eq('collection', idOf(collectionId))))
  ]);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, 26)}-${n}`;
  return slug;
}

export async function typesOf(collectionId: any): Promise<any[]> {
  if (!collectionId) return [];
  return db.requestTypes.find(eq('collection', idOf(collectionId)), { sort: [asc('created_at')], defaults: true });
}

export async function ownType(collectionId: any, id: unknown): Promise<any | null> {
  const typeId = idOf(id);
  if (!/^[0-9a-f]{24}$/i.test(typeId)) return null;
  return db.requestTypes.findOne(and(eq('_id', typeId), eq('collection', idOf(collectionId))), { defaults: true });
}

export async function typeBySlug(collectionId: any, slug: string): Promise<any | null> {
  return db.requestTypes.findOne(and(eq('collection', idOf(collectionId)), eq('slug', String(slug))), { defaults: true });
}
