import { DEFAULT_LAYOUT, LayoutSettings } from './layout';
import { CardLook, DEFAULT_CARD_LOOK } from './cardStyle';
import { Ambience, DEFAULT_AMBIENCE } from './ambience';

/**
 * Ready-made styles: whole looks offered first in the Personnalisation studio. A style
 * is what the app looks like (colours, fonts, density and corners, cards, background),
 * never where things sit: the navigation, the content width and the size of the text
 * stay as the admin set them.
 *
 * A style is applied in the studio only, by filling in the form's fields (see
 * lookStyleFields()), so it goes through the same draft, preview and save as any other
 * change, and every choice it made can then be adjusted in its own tab.
 */

type StyleLayout = Pick<LayoutSettings, 'density' | 'radius' | 'font' | 'headingFont' | 'headingCase'>;
type StyleCards = Pick<CardLook, 'frame' | 'hover' | 'text'>;
type StyleAmbience = Pick<Ambience, 'background' | 'gradient' | 'texture' | 'intensity' | 'glass'>;

export interface LookStyle {
  id: string; // studio.look_<id> and studio.look_<id>_desc
  colors: string; // a preset of config/themes.ts
  layout: StyleLayout;
  cards: StyleCards;
  ambience: StyleAmbience;
}

const style = (
  id: string,
  colors: string,
  layout: Partial<StyleLayout> = {},
  cards: Partial<StyleCards> = {},
  ambience: Partial<StyleAmbience> = {}
): LookStyle => ({
  id,
  colors,
  layout: {
    density: DEFAULT_LAYOUT.density, radius: DEFAULT_LAYOUT.radius, font: DEFAULT_LAYOUT.font,
    headingFont: DEFAULT_LAYOUT.headingFont, headingCase: DEFAULT_LAYOUT.headingCase, ...layout
  },
  cards: { frame: DEFAULT_CARD_LOOK.frame, hover: DEFAULT_CARD_LOOK.hover, text: DEFAULT_CARD_LOOK.text, ...cards },
  ambience: {
    background: 'plain', gradient: DEFAULT_AMBIENCE.gradient, texture: DEFAULT_AMBIENCE.texture,
    intensity: DEFAULT_AMBIENCE.intensity, glass: false, ...ambience
  }
});

export const LOOK_STYLES: LookStyle[] = [
  style('classic', 'default'),
  style('shop', 'sand',
    { radius: 'soft', font: 'dmsans', headingFont: 'fraunces' },
    { frame: 'outline' },
    { background: 'texture', texture: 'grooves', intensity: 'subtle' }),
  style('neon', 'midnight',
    { radius: 'round', font: 'grotesk', headingFont: 'bebas', headingCase: 'upper' },
    { hover: 'glow' },
    { background: 'gradient', gradient: 'aurora', intensity: 'strong', glass: true }),
  style('gallery', 'slate',
    { density: 'compact', radius: 'square', font: 'inter' },
    { frame: 'frameless', hover: 'zoom', text: 'overlay' }),
  style('soft', 'sakura',
    { density: 'spacious', radius: 'round', font: 'nunito' },
    {},
    { background: 'gradient', gradient: 'glow', intensity: 'subtle' }),
  style('editorial', 'blue',
    { density: 'spacious', radius: 'square', font: 'lora', headingFont: 'playfair' },
    { frame: 'outline', hover: 'none' }),
  style('retro', 'sunset',
    { font: 'outfit', headingFont: 'oswald', headingCase: 'upper' },
    { text: 'overlay' },
    { background: 'gradient', gradient: 'diagonal' }),
  style('archive', 'forest',
    { density: 'compact', radius: 'soft', font: 'inter', headingFont: 'jetbrains', headingCase: 'upper' },
    { frame: 'outline', hover: 'none' },
    { background: 'texture', texture: 'lines', intensity: 'subtle' })
];

/**
 * A style as the studio's form fields hold it, name by name: a radio's value, or a
 * checkbox's when ticked and '' when not. The options of a background the style does
 * not draw are left out: applying it keeps them as they are, and they do not count
 * when telling whether the look still is that style.
 */
export function lookStyleFields(look: LookStyle): Record<string, string> {
  const { background } = look.ambience;
  return {
    homePreset: look.colors,
    layout_density: look.layout.density,
    layout_radius: look.layout.radius,
    layout_font: look.layout.font,
    layout_headingFont: look.layout.headingFont,
    layout_headingCase: look.layout.headingCase === 'upper' ? 'upper' : '',
    card_frame: look.cards.frame,
    card_hover: look.cards.hover,
    card_text: look.cards.text,
    ambience_background: background,
    ...(background === 'gradient' ? { ambience_gradient: look.ambience.gradient } : {}),
    ...(background === 'texture' ? { ambience_texture: look.ambience.texture } : {}),
    ...(background === 'gradient' || background === 'texture' ? { ambience_intensity: look.ambience.intensity } : {}),
    ambience_glass: look.ambience.glass ? 'on' : ''
  };
}
