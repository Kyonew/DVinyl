export const CARD_CONDITION_ENUM = [
  'Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'
];

export const CARD_CONDITIONS = [
  { value: '', label: 'confirm_yugioh.condition_placeholder' },
  { value: 'Mint', label: 'confirm_yugioh.condition_mint' },
  { value: 'Near Mint', label: 'confirm_yugioh.condition_near_mint' },
  { value: 'Lightly Played', label: 'confirm_yugioh.condition_lightly_played' },
  { value: 'Moderately Played', label: 'confirm_yugioh.condition_moderately_played' },
  { value: 'Heavily Played', label: 'confirm_yugioh.condition_heavily_played' },
  { value: 'Damaged', label: 'confirm_yugioh.condition_damaged' }
];

// Colors match the real card frame colors: monster frames are orange/brown, spells
// green, traps magenta.
export const YUGIOH_FORMATS = [
  { value: 'Monster', label: 'format.yugioh_type_monster', color: 'bg-orange-600/90' },
  { value: 'Spell', label: 'format.yugioh_type_spell', color: 'bg-emerald-600/90' },
  { value: 'Trap', label: 'format.yugioh_type_trap', color: 'bg-fuchsia-800/90' }
];

/** YGOPRODeck's `type` field is granular ("Normal Monster", "Quick-Play Spell Card",
 * "Continuous Trap Card", ...); this collapses it to the three badge values. */
export function deriveYugiohFormat(type: string): string {
  const t = (type || '');
  if (t.includes('Monster')) return 'Monster';
  if (t.includes('Spell')) return 'Spell';
  if (t.includes('Trap')) return 'Trap';
  return 'Monster';
}
