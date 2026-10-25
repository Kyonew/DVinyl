export const CARD_CONDITION_ENUM = [
  'Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'
];

export const CARD_CONDITIONS = [
  { value: '', label: 'confirm_onepiece.condition_placeholder' },
  { value: 'Mint', label: 'confirm_onepiece.condition_mint' },
  { value: 'Near Mint', label: 'confirm_onepiece.condition_near_mint' },
  { value: 'Lightly Played', label: 'confirm_onepiece.condition_lightly_played' },
  { value: 'Moderately Played', label: 'confirm_onepiece.condition_moderately_played' },
  { value: 'Heavily Played', label: 'confirm_onepiece.condition_heavily_played' },
  { value: 'Damaged', label: 'confirm_onepiece.condition_damaged' }
];

export const ONEPIECE_FORMATS = [
  { value: 'Leader', label: 'format.onepiece_type_leader', color: 'bg-red-600/90' },
  { value: 'Character', label: 'format.onepiece_type_character', color: 'bg-sky-600/90' },
  { value: 'Event', label: 'format.onepiece_type_event', color: 'bg-purple-600/90' },
  { value: 'Stage', label: 'format.onepiece_type_stage', color: 'bg-emerald-600/90' }
];
