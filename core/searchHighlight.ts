import { escapeRegExp } from './helpers.js';

// Drawn over the card and table text, so it borrows the theme colour rather than the
// browser's yellow, which reads poorly on the dark themes.
const MARK_CLASS = 'bg-primary-theme/25 text-inherit rounded-sm';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escaped HTML of `text` with every occurrence of `query` wrapped in a <mark>.
 * Matches the way the collection search does (plain substring, case ignored), so
 * what lights up is what made the item come back. Always safe to print unescaped.
 */
export function highlightMatches(text: unknown, query: unknown): string {
  const value = text == null ? '' : String(text);
  const needle = typeof query === 'string' ? query.trim() : '';
  if (!needle || !value) return escapeHtml(value);

  const regex = new RegExp(escapeRegExp(needle), 'gi');
  let html = '';
  let last = 0;
  for (const match of value.matchAll(regex)) {
    const start = match.index!;
    html += escapeHtml(value.slice(last, start));
    html += `<mark class="${MARK_CLASS}">${escapeHtml(match[0])}</mark>`;
    last = start + match[0].length;
  }
  return html + escapeHtml(value.slice(last));
}
