// Shared TCG-standard condition scale — duplicated verbatim across all four TCG
// plugins (see docs/superpowers/plans/2026-09-01-tcg-plugins.md "Global Constraints"),
// not the same scale as music's M/NM/VG+/... sleeve condition.
export const CARD_CONDITION_ENUM = [
  'Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'
];

export const CARD_CONDITIONS = [
  { value: '', label: 'confirm_pokemon.condition_placeholder' },
  { value: 'Mint', label: 'confirm_pokemon.condition_mint' },
  { value: 'Near Mint', label: 'confirm_pokemon.condition_near_mint' },
  { value: 'Lightly Played', label: 'confirm_pokemon.condition_lightly_played' },
  { value: 'Moderately Played', label: 'confirm_pokemon.condition_moderately_played' },
  { value: 'Heavily Played', label: 'confirm_pokemon.condition_heavily_played' },
  { value: 'Damaged', label: 'confirm_pokemon.condition_damaged' }
];

export const POKEMON_FORMATS = [
  { value: 'Pokemon', label: 'format.pokemon_category_pokemon', color: 'bg-amber-600/90' },
  { value: 'Trainer', label: 'format.pokemon_category_trainer', color: 'bg-sky-600/90' },
  { value: 'Energy', label: 'format.pokemon_category_energy', color: 'bg-emerald-600/90' }
];
