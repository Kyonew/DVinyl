export const CARD_CONDITION_ENUM = [
  'Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'
];

export const CARD_CONDITIONS = [
  { value: '', label: 'confirm_mtg.condition_placeholder' },
  { value: 'Mint', label: 'confirm_mtg.condition_mint' },
  { value: 'Near Mint', label: 'confirm_mtg.condition_near_mint' },
  { value: 'Lightly Played', label: 'confirm_mtg.condition_lightly_played' },
  { value: 'Moderately Played', label: 'confirm_mtg.condition_moderately_played' },
  { value: 'Heavily Played', label: 'confirm_mtg.condition_heavily_played' },
  { value: 'Damaged', label: 'confirm_mtg.condition_damaged' }
];

// Checked in this order against the words before the em-dash in `type_line`, so an
// "Artifact Creature" registers as Creature (the way players actually talk about it)
// rather than Artifact. Named `card_type`, not `format`, because "format" already
// means something else entirely in Magic (Standard/Modern/Legacy legality).
export const MTG_TYPE_PRIORITY = [
  'Creature', 'Planeswalker', 'Battle', 'Land', 'Instant', 'Sorcery', 'Artifact', 'Enchantment'
];

export const MTG_FORMATS = [
  { value: 'Creature', label: 'format.mtg_type_creature', color: 'bg-emerald-600/90' },
  { value: 'Planeswalker', label: 'format.mtg_type_planeswalker', color: 'bg-red-600/90' },
  { value: 'Battle', label: 'format.mtg_type_battle', color: 'bg-orange-600/90' },
  { value: 'Land', label: 'format.mtg_type_land', color: 'bg-amber-700/90' },
  { value: 'Instant', label: 'format.mtg_type_instant', color: 'bg-sky-600/90' },
  { value: 'Sorcery', label: 'format.mtg_type_sorcery', color: 'bg-purple-600/90' },
  { value: 'Artifact', label: 'format.mtg_type_artifact', color: 'bg-slate-600/90' },
  { value: 'Enchantment', label: 'format.mtg_type_enchantment', color: 'bg-fuchsia-600/90' }
];

const COLOR_NAMES: Record<string, string> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green'
};

/** Maps Scryfall's single-letter `colors` array to full names for the genre mirror. */
export function expandColors(colors: string[] | undefined): string[] {
  if (!colors || colors.length === 0) return ['Colorless'];
  return colors.map(c => COLOR_NAMES[c] || c);
}

export function deriveMtgFormat(typeLine: string): string {
  const words = (typeLine || '').split('—')[0]!.trim().split(/\s+/);
  return MTG_TYPE_PRIORITY.find(t => words.includes(t)) || 'Creature';
}
