// Rebrickable REST API (https://rebrickable.com/api/). The key is passed as an
// `Authorization: key <KEY>` header on every request.
export const REBRICKABLE_BASE = 'https://rebrickable.com/api/v3/lego';

export function rebrickableHeaders(): Record<string, string> {
  const apiKey = process.env.REBRICKABLE_API_KEY;
  if (!apiKey) throw new Error('REBRICKABLE_API_KEY missing');
  return {
    Authorization: `key ${apiKey}`,
    'User-Agent': 'DVinylApp/2.0',
    Accept: 'application/json'
  };
}

// Deterministic badge color per theme so a given theme always keeps the same
// color across cards (the badge shows the LEGO theme, not the physical condition).
const THEME_BADGE_COLORS = [
  'bg-red-600/90',
  'bg-amber-600/90',
  'bg-emerald-600/90',
  'bg-sky-600/90',
  'bg-indigo-600/90',
  'bg-purple-600/90',
  'bg-rose-600/90',
  'bg-teal-600/90',
  'bg-orange-600/90',
  'bg-lime-600/90',
  'bg-cyan-600/90',
  'bg-fuchsia-600/90'
];

export function themeBadgeColor(theme: string): string {
  const key = (theme || '').trim();
  if (!key) return 'bg-gray-600/90';
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return THEME_BADGE_COLORS[hash % THEME_BADGE_COLORS.length] || 'bg-gray-600/90';
}
