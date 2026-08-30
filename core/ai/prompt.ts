import { ImportTargetField } from '../csvMapping';
import { AiContentPart, AiMessage } from './types';

/**
 * The destination fields, written for a model.
 *
 * Built from importableFields(), which already derives the full destination list from any
 * PluginDefinition — its form fields, its schema paths and the collection's user-defined
 * extra fields. So this is correct for books, music, board games and a plugin somebody
 * writes next month, without any of them being named here.
 */
export function describeFields(fields: ImportTargetField[]): string {
  return fields.map(field => {
    const notes: string[] = [field.type];
    if (field.required) notes.push('required');
    if (field.options?.length) {
      notes.push(`one of: ${field.options.map(o => o.value).join(', ')}`);
    }
    return `- ${field.name} (${notes.join(', ')}): ${field.label}`;
  }).join('\n');
}

/**
 * The system and user messages for an extraction.
 *
 * Values are demanded as strings because every one of them is handed to coerceValue()
 * from core/csvMapping, the same function the CSV import already uses to turn a
 * spreadsheet cell into a typed value. One coercion path, already proven on real exports.
 */
export function buildExtractionMessages(
  fields: ImportTargetField[],
  instruction: string,
  userParts: AiContentPart[]
): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'You extract catalogue entries and return data, never prose.\n\n' +
        'Return a JSON array. Each element is one item, an object whose keys are taken ' +
        'from this list of fields:\n\n' +
        `${describeFields(fields)}\n\n` +
        'Rules:\n' +
        '- Every value must be a string. Use an empty string for anything you do not know.\n' +
        '- Never invent a publisher, a year, an ISBN or a page count. An empty string is ' +
        'always better than a plausible guess.\n' +
        '- Omit keys that are not in the list above.\n' +
        '- Return only the JSON array, with no commentary and no code fence.\n' +
        '- If you find no items at all, return [].'
    },
    {
      role: 'user',
      content: [{ type: 'text', text: instruction }, ...userParts]
    }
  ];
}
