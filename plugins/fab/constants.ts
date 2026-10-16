export const CARD_CONDITION_ENUM = [
  'Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'
];

export const CARD_CONDITIONS = [
  { value: '', label: 'confirm_fab.condition_placeholder' },
  { value: 'Mint', label: 'confirm_fab.condition_mint' },
  { value: 'Near Mint', label: 'confirm_fab.condition_near_mint' },
  { value: 'Lightly Played', label: 'confirm_fab.condition_lightly_played' },
  { value: 'Moderately Played', label: 'confirm_fab.condition_moderately_played' },
  { value: 'Heavily Played', label: 'confirm_fab.condition_heavily_played' },
  { value: 'Damaged', label: 'confirm_fab.condition_damaged' }
];

// The badge axis is pitch COLOR, not card type: F&B's type text is compound/free-form
// ("Ninja Attack Reaction", "Warrior Hero - Young") and doesn't reduce to a clean fixed
// enum, while color is the one universal fixed-vocabulary attribute every pitchable
// card has. Hero/equipment cards have no color (''), and simply fall through to the
// generic gray-badge fallback every plugin's cardBadge() already provides.
export const FAB_FORMATS = [
  { value: 'Red', label: 'format.fab_color_red', color: 'bg-red-600/90' },
  { value: 'Yellow', label: 'format.fab_color_yellow', color: 'bg-yellow-500/90' },
  { value: 'Blue', label: 'format.fab_color_blue', color: 'bg-blue-600/90' }
];
