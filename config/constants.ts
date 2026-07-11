export const BASE_URL: string = process.env.BASE_URL
  ? (process.env.BASE_URL.startsWith('/') ? process.env.BASE_URL : `/${process.env.BASE_URL}`)
  : ''
