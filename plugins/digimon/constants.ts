export const CARD_CONDITION_ENUM = [
  'Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'
];

export const CARD_CONDITIONS = [
  { value: '', label: 'confirm_digimon.condition_placeholder' },
  { value: 'Mint', label: 'confirm_digimon.condition_mint' },
  { value: 'Near Mint', label: 'confirm_digimon.condition_near_mint' },
  { value: 'Lightly Played', label: 'confirm_digimon.condition_lightly_played' },
  { value: 'Moderately Played', label: 'confirm_digimon.condition_moderately_played' },
  { value: 'Heavily Played', label: 'confirm_digimon.condition_heavily_played' },
  { value: 'Damaged', label: 'confirm_digimon.condition_damaged' }
];

export const DIGIMON_FORMATS = [
  { value: 'Digimon', label: 'format.digimon_type_digimon', color: 'bg-orange-600/90' },
  { value: 'Tamer', label: 'format.digimon_type_tamer', color: 'bg-sky-600/90' },
  { value: 'Option', label: 'format.digimon_type_option', color: 'bg-purple-600/90' },
  { value: 'Digi-Egg', label: 'format.digimon_type_digiegg', color: 'bg-emerald-600/90' }
];
