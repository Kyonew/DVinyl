/**
 * The ambience of a collection (settings.ambience), chosen by its admin in the
 * Personnalisation studio: what lies behind the pages (a plain colour, a gradient or a
 * pattern drawn from the theme's accent, or a picture), whether the surfaces let it show
 * through like frosted glass, whether an item's page takes its accent from the cover,
 * and the collection's own logo.
 *
 * Drawn by the shell only (partials/header.ejs, partials/shell/backdrop, styles and
 * cover-accent), through data attributes on <html> and one fixed layer behind the page.
 * The picture and the logo are uploads of the shared pool (core/itemImageStorage.ts),
 * referenced from here: the sweep keeps them and the backups carry them (see
 * ambienceImages()). Neither travels in a look pack, which holds no URL.
 */

import { managedItemImageFile } from './itemImageStorage';

export const BACKGROUNDS = ['plain', 'gradient', 'texture', 'image'] as const;
export const GRADIENTS = ['glow', 'diagonal', 'aurora'] as const;
export const TEXTURES = ['grain', 'grooves', 'dots', 'lines'] as const;
export const INTENSITIES = ['subtle', 'normal', 'strong'] as const;
export const IMAGE_BLURS = ['none', 'soft', 'strong'] as const;
export const IMAGE_VEILS = ['light', 'medium', 'strong'] as const;

export interface Ambience {
  background: typeof BACKGROUNDS[number];
  gradient: typeof GRADIENTS[number];
  texture: typeof TEXTURES[number];
  intensity: typeof INTENSITIES[number];
  // An upload of this instance ('/uploads/items/item-<uuid>.jpg'), or ''.
  image: string;
  imageBlur: typeof IMAGE_BLURS[number];
  imageVeil: typeof IMAGE_VEILS[number];
  glass: boolean;
  coverAccent: boolean;
  logo: string;
}

export const DEFAULT_AMBIENCE: Ambience = {
  background: 'plain',
  gradient: 'glow',
  texture: 'grain',
  intensity: 'normal',
  image: '',
  imageBlur: 'soft',
  imageVeil: 'medium',
  glass: false,
  coverAccent: false,
  logo: ''
};

const pick = <T extends readonly string[]>(allowed: T, value: unknown, fallback: T[number]): T[number] =>
  (allowed as readonly string[]).includes(value as string) ? (value as T[number]) : fallback;

const toBool = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  if (value === 'on' || value === 'true') return true;
  if (value === 'false' || value === '') return false;
  return fallback;
};

// Only an upload of this instance: the path ends up in a style attribute and an <img>.
const upload = (value: unknown): string =>
  typeof value === 'string' && managedItemImageFile(value) ? value.trim() : '';

/** Only the offered values and this instance's uploads pass, whatever is stored or posted. */
export function normalizeAmbience(raw: any): Ambience {
  const src = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_AMBIENCE;
  return {
    background: pick(BACKGROUNDS, src.background, d.background),
    gradient: pick(GRADIENTS, src.gradient, d.gradient),
    texture: pick(TEXTURES, src.texture, d.texture),
    intensity: pick(INTENSITIES, src.intensity, d.intensity),
    image: upload(src.image),
    imageBlur: pick(IMAGE_BLURS, src.imageBlur, d.imageBlur),
    imageVeil: pick(IMAGE_VEILS, src.imageVeil, d.imageVeil),
    glass: toBool(src.glass, d.glass),
    coverAccent: toBool(src.coverAccent, d.coverAccent),
    logo: upload(src.logo)
  };
}

/** Reads the studio's fields, named ambience_<key>; an unticked checkbox is not posted. */
export function ambienceFromForm(body: any): Ambience {
  const src = body && typeof body === 'object' ? body : {};
  return normalizeAmbience({
    background: src.ambience_background,
    gradient: src.ambience_gradient,
    texture: src.ambience_texture,
    intensity: src.ambience_intensity,
    image: src.ambience_image,
    imageBlur: src.ambience_imageBlur,
    imageVeil: src.ambience_imageVeil,
    glass: src.ambience_glass === 'on',
    coverAccent: src.ambience_coverAccent === 'on',
    logo: src.ambience_logo
  });
}

/** What a look pack carries: everything but the uploads. */
export function shareableAmbience(raw: any): Ambience {
  return { ...normalizeAmbience(raw), image: '', logo: '' };
}

/** The uploads a Settings document points at, for the sweep and the backups. */
export function ambienceImages(settings: any): string[] {
  const ambience = settings?.ambience;
  if (!ambience || typeof ambience !== 'object') return [];
  return [ambience.image, ambience.logo].filter(value => typeof value === 'string' && managedItemImageFile(value));
}

export interface ResolvedAmbience extends Ambience {
  // What the shell draws behind the page: nothing for a plain colour, nor for a picture
  // whose upload is gone.
  backdrop: 'none' | 'gradient' | 'texture' | 'image';
  cssVars: Record<string, string>;
}

const INTENSITY_FACTOR: Record<Ambience['intensity'], number> = { subtle: 0.6, normal: 1, strong: 1.6 };
const BLUR: Record<Ambience['imageBlur'], string> = { none: '0px', soft: '6px', strong: '18px' };
const VEIL: Record<Ambience['imageVeil'], number> = { light: 0.4, medium: 0.62, strong: 0.8 };

export function resolveAmbience(settings: any): ResolvedAmbience {
  const ambience = normalizeAmbience(settings?.ambience);
  const backdrop = ambience.background === 'plain' || (ambience.background === 'image' && !ambience.image)
    ? 'none'
    : ambience.background;
  return {
    ...ambience,
    backdrop,
    cssVars: {
      '--dv-bg-k': String(INTENSITY_FACTOR[ambience.intensity]),
      '--dv-bg-blur': BLUR[ambience.imageBlur],
      '--dv-bg-veil': String(VEIL[ambience.imageVeil])
    }
  };
}

// Option lists for the studio, in display order.
export const AMBIENCE_OPTIONS = {
  background: BACKGROUNDS,
  gradient: GRADIENTS,
  texture: TEXTURES,
  intensity: INTENSITIES,
  imageBlur: IMAGE_BLURS,
  imageVeil: IMAGE_VEILS
};
