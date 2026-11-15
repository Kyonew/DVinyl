export const CARD_CONDITION_ENUM = [
  'Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'
];

export const CARD_CONDITIONS = [
  { value: '', label: 'confirm_swu.condition_placeholder' },
  { value: 'Mint', label: 'confirm_swu.condition_mint' },
  { value: 'Near Mint', label: 'confirm_swu.condition_near_mint' },
  { value: 'Lightly Played', label: 'confirm_swu.condition_lightly_played' },
  { value: 'Moderately Played', label: 'confirm_swu.condition_moderately_played' },
  { value: 'Heavily Played', label: 'confirm_swu.condition_heavily_played' },
  { value: 'Damaged', label: 'confirm_swu.condition_damaged' }
];

export const SWU_FORMATS = [
  { value: 'Leader', label: 'format.swu_type_leader', color: 'bg-red-600/90' },
  { value: 'Base', label: 'format.swu_type_base', color: 'bg-slate-600/90' },
  { value: 'Unit', label: 'format.swu_type_unit', color: 'bg-sky-600/90' },
  { value: 'Event', label: 'format.swu_type_event', color: 'bg-amber-600/90' }
];
