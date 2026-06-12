export const STANDARD_FORMAT_TERMS: string[] = [
  'Vinyl', 'LP', 'Album', 'Reissue', 'Repress', 'Stereo', 'Gatefold',
  '12"', '7"', 'Limited Edition', 'Compilation', 'Deluxe Edition', 'Numbered', 'Promo'
];

export const BOOK_GENRES_WHITELIST: string[] = [
  'Fiction', 'Non-Fiction', 'Fantasy', 'Sci-Fi', 'Science Fiction', 'Mystery',
  'Thriller', 'Horror', 'Historical', 'Romance', 'Comedy', 'Young Adult',
  'Children', 'Biography', 'Autobiography', 'Memoir', 'Poetry', 'Essay',
  'Self Help', 'Yuri', 'Slice of life', 'Adventure', 'Action', 'Drama', 'Crime',
  'LGBTQ', 'LGBTQIA', 'LGBTQIA+'
];

export const BASE_URL: string = process.env.BASE_URL
  ? (process.env.BASE_URL.startsWith('/') ? process.env.BASE_URL : `/${process.env.BASE_URL}`)
  : ''

export const TMDB_LANG_MAP: Record<string, string> = {
  fr: "fr-FR",
  en: "en-US",
  es: "es-ES",
  it: "it-IT",
  de: "de-DE"
}

