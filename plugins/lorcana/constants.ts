export const CARD_CONDITION_ENUM = [
  'Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'
];

export const CARD_CONDITIONS = [
  { value: '', label: 'confirm_lorcana.condition_placeholder' },
  { value: 'Mint', label: 'confirm_lorcana.condition_mint' },
  { value: 'Near Mint', label: 'confirm_lorcana.condition_near_mint' },
  { value: 'Lightly Played', label: 'confirm_lorcana.condition_lightly_played' },
  { value: 'Moderately Played', label: 'confirm_lorcana.condition_moderately_played' },
  { value: 'Heavily Played', label: 'confirm_lorcana.condition_heavily_played' },
  { value: 'Damaged', label: 'confirm_lorcana.condition_damaged' }
];

export const LORCANA_FORMATS = [
  { value: 'Character', label: 'format.lorcana_type_character', color: 'bg-sky-600/90' },
  { value: 'Action', label: 'format.lorcana_type_action', color: 'bg-purple-600/90' },
  { value: 'Item', label: 'format.lorcana_type_item', color: 'bg-emerald-600/90' },
  { value: 'Location', label: 'format.lorcana_type_location', color: 'bg-amber-600/90' },
  { value: 'Song', label: 'format.lorcana_type_song', color: 'bg-fuchsia-600/90' }
];
