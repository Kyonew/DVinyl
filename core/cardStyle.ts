/**
 * How the item cards of a collection look (settings.cards), chosen by its admin in the
 * Personnalisation studio: their frame, what a pointer over them does, where their text
 * sits and whether the format badge shows. The cover's shape stays aspectRatioClass.
 *
 * Read by the item grid only (partials/albums-grid, item-cover, item-card-body), which
 * turns it into classes through cardClasses(). Below md the card keeps the phone's
 * frameless tile whatever the frame chosen, and there is no pointer to hover with; the
 * text placement and the badge apply everywhere.
 */

export const CARD_FRAMES = ['filled', 'outline', 'frameless'] as const;
export const CARD_HOVERS = ['lift', 'zoom', 'glow', 'none'] as const;
export const CARD_TEXTS = ['below', 'overlay', 'hidden'] as const;

export interface CardLook {
  frame: typeof CARD_FRAMES[number];
  hover: typeof CARD_HOVERS[number];
  text: typeof CARD_TEXTS[number];
  badges: boolean;
}

export const DEFAULT_CARD_LOOK: CardLook = { frame: 'filled', hover: 'lift', text: 'below', badges: true };

const pick = <T extends readonly string[]>(allowed: T, value: unknown, fallback: T[number]): T[number] =>
  (allowed as readonly string[]).includes(value as string) ? (value as T[number]) : fallback;

/** Only the offered values pass: each one picks classes set on every card. */
export function normalizeCardLook(raw: any): CardLook {
  const src = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_CARD_LOOK;
  return {
    frame: pick(CARD_FRAMES, src.frame, d.frame),
    hover: pick(CARD_HOVERS, src.hover, d.hover),
    text: pick(CARD_TEXTS, src.text, d.text),
    badges: typeof src.badges === 'boolean' ? src.badges : d.badges
  };
}

/** Reads the studio's card fields, named card_<key>; an unticked checkbox is not posted. */
export function cardLookFromForm(body: any): CardLook {
  const src = body && typeof body === 'object' ? body : {};
  return normalizeCardLook({
    frame: src.card_frame,
    hover: src.card_hover,
    text: src.card_text,
    badges: src.card_badges === 'on'
  });
}

export interface CardClasses {
  look: CardLook;
  // The card itself, its whole tile.
  card: string;
  // The box around the cover, which carries the shape when the card has no frame.
  cover: string;
  // Added to the cover image, for the zoom.
  image: string;
  // The "received it" button of a wishlist card.
  received: string;
}

// The frameless phone tile, kept below md for every frame.
const PHONE_CARD = 'max-md:!bg-transparent max-md:!border-0 max-md:overflow-visible max-md:hover:translate-y-0 max-md:hover:shadow-none';
const PHONE_COVER = 'max-md:rounded-xl max-md:overflow-hidden max-md:shadow-lg max-md:shadow-black/25';

/** The classes the item grid puts on a card, its cover and the cover image. */
export function cardClasses(raw: any): CardClasses {
  const look = normalizeCardLook(raw);
  const frameless = look.frame === 'frameless';

  const frame = {
    filled: 'card-theme overflow-hidden',
    outline: 'overflow-hidden border border-[var(--border-color)]',
    frameless: 'md:overflow-visible'
  }[look.frame];

  // Whatever is lifted or lit: the card, or the cover alone when there is no frame, as
  // the pointer enters the card (the cover follows the whole tile, text included).
  const on = frameless ? 'md:group-hover:' : 'md:hover:';
  const hover = {
    lift: frameless ? `${on}shadow-xl ${on}-translate-y-1` : 'hover:border-primary-theme hover:shadow-lg hover:-translate-y-1',
    zoom: '',
    glow: `${on}ring-2 ${on}ring-primary-theme ${on}shadow-xl ${on}shadow-primary-theme/30`,
    none: ''
  }[look.hover];

  return {
    look,
    card: ['album-card group relative rounded-xl flex flex-col justify-between transition-all duration-300', frame, frameless ? '' : hover, PHONE_CARD]
      .filter(Boolean).join(' '),
    cover: frameless
      ? `relative rounded-xl overflow-hidden shadow-lg shadow-black/25 transition-all duration-300 ${hover}`.trim()
      : `relative ${PHONE_COVER}`,
    image: look.hover === 'lift' || look.hover === 'zoom' ? 'group-hover:scale-105' : '',
    received: frameless ? 'md:mt-2 md:rounded-lg md:border-0' : ''
  };
}
