import { PluginDefinition } from '../../core/types';
import { HardcoverProvider } from './hardcover';
import { booksImporters } from './importers';
import { escapeRegExp, fetchJson } from '../../core/helpers';
import Item from '../../models/Item';

export const booksPlugin: PluginDefinition = {
  id: 'books',
  kind: 'Book',
  label: 'media.books',
  i18nKey: 'book',
  order: 20,
  externalIdField: 'hardcover_slug',
  creatorSearchFields: ['publisher'],
  summaryField: { label: 'confirm_book.publisher_label', field: 'publisher' },
  externalLink(item: any) {
    return item.hardcover_slug ? { label: 'Hardcover', url: `https://hardcover.app/books/${item.hardcover_slug}` } : null;
  },
  icon: 'book',
  routePrefix: '/book',
  collectionType: 'books',
  creatorField: 'author',
  extraSearchFields: ['isbn', 'publisher'],
  supportsBarcodeSearch: false,
  searchProvider: new HardcoverProvider(),
  imageSearchType: 'book',
  importers: booksImporters,
  requiredEnvKeys: ['HARDCOVER_API_KEY'],
  duplicateCheckFields: ['format'],
  backfillFields: ['isbn'],
  partialsPath: 'plugins/books/partials',
  detailZones: [
    { id: 'badge', partial: 'reading-status.ejs' },
    { id: 'sidebar', partial: 'status-blocks.ejs' }
  ],

  fastAddOptions: [
    { value: 'book', label: 'media.books', icon: 'fa-book', color: 'peer-checked:bg-amber-600', url: '/add-books' }
  ],

  imageSearchProvider: {
    async search(query: string): Promise<string[]> {
      const data = await fetchJson(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10`,
        { headers: { 'User-Agent': 'DVinylApp/2.0' }, signal: AbortSignal.timeout(10000) }
      );
      return (data.docs || [])
        .filter((doc: any) => doc.cover_i)
        .map((doc: any) => `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`);
    }
  },

  navbarShortcuts: [
    { id: 'books', label: 'media.books', url: '/collection?type=books' },
    { id: 'book_hardcover', label: 'media.hardcover', url: '/collection?type=books&format=hardcover' },
    { id: 'book_paperback', label: 'media.paperback', url: '/collection?type=books&format=paperback' },
    { id: 'book_manga', label: 'media.manga', url: '/collection?type=books&format=manga' },
    { id: 'book_comic', label: 'media.comic', url: '/collection?type=books&format=comic' },
    { id: 'book_graphic_novel', label: 'media.graphic_novel', url: '/collection?type=books&format=graphic_novel' },
    { id: 'book_digital', label: 'media.digital', url: '/collection?type=books&format=digital' }
  ],

  statsWidgets: [
    { id: 'book_total', label: 'stats.books_total_label', icon: 'fa-book', color: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600', kind: 'count' },
    { id: 'book_hardcover', label: 'media.hardcover_pl', icon: 'fa-book-atlas', color: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-600', kind: 'count' },
    { id: 'book_paperback', label: 'media.paperback_pl', icon: 'fa-book-journal-whills', color: 'bg-fuchsia-100 dark:bg-fuchsia-900/30', text: 'text-fuchsia-600', kind: 'count' },
    { id: 'book_manga', label: 'media.mangas', icon: 'fa-book-open', color: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-600', kind: 'count' },
    { id: 'book_comic', label: 'media.comics', icon: 'fa-mask', color: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-600', kind: 'count' },
    { id: 'book_digital', label: 'media.digital', icon: 'fa-cloud', color: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-600', kind: 'count' },
    { id: 'author', label: 'stats.top_author_label', icon: 'fa-pen-nib', color: 'bg-amber-100 dark:bg-amber-500/20', kind: 'top' },
    { id: 'publisher', label: 'stats.top_publisher_label', icon: 'fa-book-open', color: 'bg-orange-100 dark:bg-orange-500/20', kind: 'top' }
  ],

  schemaDefinition: {
    author: { type: String, required: true },
    hardcover_slug: { type: String, default: '' },
    source: { type: String, enum: ['hardcover', 'goodreads', 'manual'], default: 'manual' },
    publisher: String,
    isbn: String,
    pages: Number,
    language: String,
    format: {
      type: String,
      enum: ['hardcover', 'paperback', 'manga', 'comic', 'graphic_novel', 'digital'],
      default: 'paperback'
    },
    series: String,
    volume: Number,
    readingStatus: {
      type: String,
      enum: ['to_read', 'reading', 'read'],
      default: 'to_read'
    },
    rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
    },
    genre: { type: String, default: '' },
    genres: { type: [String], default: [] },
    styles: { type: [String], default: [] },
    description: { type: String, default: '' }
  },

  formats: [
    { value: 'paperback', label: 'format.paperback', color: 'bg-amber-600/90' },
    { value: 'hardcover', label: 'format.hardcover', color: 'bg-purple-600/90' },
    { value: 'manga', label: 'format.manga', color: 'bg-pink-600/90' },
    { value: 'comic', label: 'format.comic', color: 'bg-indigo-600/90' },
    { value: 'graphic_novel', label: 'format.graphic_novel', color: 'bg-violet-600/90' },
    { value: 'digital', label: 'format.digital', color: 'bg-cyan-600/90' }
  ],

  formFields: [
    {
      name: 'title',
      label: 'confirm_book.field_title',
      type: 'text',
      required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'author',
      label: 'confirm_book.field_author',
      type: 'text',
      required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'publisher',
      label: 'confirm_book.field_publisher',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata',
      placeholder: 'placeholders.publisher'
    },
    {
      name: 'year',
      label: 'confirm_book.field_year',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata',
      placeholder: 'placeholders.year'
    },
    {
      name: 'barcode',
      label: 'confirm_book.field_isbn',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata',
      placeholder: 'ISBN...'
    },
    {
      name: 'format',
      label: 'confirm_book.field_format',
      type: 'select',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main',
      options: [
        { value: 'paperback', label: 'format.paperback' },
        { value: 'hardcover', label: 'format.hardcover' },
        { value: 'manga', label: 'format.manga' },
        { value: 'comic', label: 'format.comic' },
        { value: 'graphic_novel', label: 'format.graphic_novel' },
        { value: 'digital', label: 'format.digital' }
      ]
    },
    {
      name: 'quantity',
      label: 'confirm_vinyl.field_quantity',
      type: 'number',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main'
    },
    {
      name: 'pages',
      label: 'confirm_book.field_pages',
      type: 'number',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata'
    },
    {
      name: 'language',
      label: 'confirm_book.field_language',
      type: 'text',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'Ex: fr, en'
    },
    {
      name: 'series',
      label: 'confirm_book.field_series',
      type: 'text',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'Ex: Harry Potter'
    },
    {
      name: 'volume',
      label: 'confirm_book.field_volume',
      type: 'number',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'Numéro'
    },
    {
      name: 'readingStatus',
      label: 'confirm_book.field_status',
      type: 'select',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      options: [
        { value: 'to_read', label: 'status.to_read' },
        { value: 'reading', label: 'status.reading' },
        { value: 'read', label: 'status.read' }
      ]
    },
    {
      name: 'rating',
      label: 'confirm_book.field_rating',
      type: 'number',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'Ex: 4'
    },
    {
      name: 'comments',
      label: 'confirm_vinyl.field_comments',
      type: 'textarea',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'confirm_vinyl.comments_placeholder'
    },
    {
      name: 'location',
      label: 'common.location',
      type: 'text',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'placeholders.location'
    }
  ],

  getStats(items: any[]): Record<string, any> {
    const countByFormat = (format: string) => {
      return items
        .filter(i => (i.format || '').toLowerCase() === format.toLowerCase())
        .reduce((acc, i) => acc + Number(i.quantity || 1), 0);
    };

    const getTop = (field: string) => {
      const map: Record<string, number> = {};
      let topName = 'N/A';
      let topCount = 0;
      items.forEach(item => {
        const name = item[field];
        if (name) {
          map[name] = (map[name] || 0) + 1;
          if (map[name] > topCount) {
            topCount = map[name];
            topName = name;
          }
        }
      });
      return { name: topName, count: topCount };
    };

    return {
      book_total: items.reduce((acc, i) => acc + Number(i.quantity || 1), 0),
      book_manga: countByFormat('manga'),
      book_comic: countByFormat('comic'),
      book_hardcover: countByFormat('hardcover'),
      book_paperback: countByFormat('paperback'),
      book_digital: countByFormat('digital'),
      author: getTop('author'),
      publisher: getTop('publisher')
    };
  },

  formatForView(item: any): any {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;
    return {
      ...obj,
      author: obj.author || 'Unknown',
      cover_image: obj.cover_image || '/ressources/no_book.png',
      publisher: obj.publisher || '',
      year: obj.year || '',
      pages: obj.pages || 0,
      language: obj.language || '',
      series: obj.series || '',
      volume: obj.volume || null,
      readingStatus: obj.readingStatus || 'to_read',
      rating: obj.rating || 0,
      location: obj.location || '',
      genre: obj.genre || '',
      quantity: obj.quantity || 1
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const matchFormat = data.format || 'paperback';
    const isbn = data.isbn || data.barcode;

    if (isbn) {
      const cleanIsbn = String(isbn).replace(/[- ]/g, '');
      const query: any = {
        collection: collectionId,
        in_wishlist: false,
        kind: 'Book',
        $or: [
          { isbn: cleanIsbn },
          { barcode: cleanIsbn }
        ]
      };
      if (matchFormat) {
        query.format = matchFormat;
      }
      const item = await Item.findOne(query);
      if (item) return item;
    }

    const matchTitle = (data.title || '').trim();
    const matchAuthor = (data.author || data.creator || '').trim();

    const query: any = {
      collection: collectionId,
      in_wishlist: false,
      kind: 'Book',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') },
      author: { $regex: new RegExp(`^${escapeRegExp(matchAuthor)}$`, 'i') }
    };

    if (matchFormat) {
      query.format = matchFormat;
    }
    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    const cleanIsbn = String(data.isbn || data.barcode || '').replace(/[- ]/g, '');
    if (cleanIsbn) {
      or.push({ isbn: cleanIsbn }, { barcode: cleanIsbn });
    }
    const title = (data.title || '').trim();
    const author = (data.author || data.creator || '').trim();
    if (title && author) {
      or.push({
        title: { $regex: new RegExp(`^${escapeRegExp(title)}$`, 'i') },
        author: { $regex: new RegExp(`^${escapeRegExp(author)}$`, 'i') }
      });
    }
    if (or.length === 0) return [];
    return Item.find({
      collection: collectionId,
      in_wishlist: false,
      kind: 'Book',
      $or: or
    }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return await Item.find({
      collection: item.collection,
      in_wishlist: false,
      kind: 'Book',
      _id: { $ne: item._id },
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') },
      author: { $regex: new RegExp(`^${escapeRegExp(item.author)}$`, 'i') }
    }).lean();
  },

  // For books the ISBN and the generic barcode are the same identifier; keep both in
  // sync so a manual entry (where the user only fills the ISBN-labelled barcode field)
  // still populates the dedicated `isbn` field, and vice-versa.
  normalizeForSave(data: Record<string, any>): void {
    const isbn = String(data.isbn || '').replace(/[- ]/g, '');
    const barcode = String(data.barcode || '').replace(/[- ]/g, '');
    const canonical = isbn || barcode;
    if (canonical) {
      if (!data.isbn) data.isbn = canonical;
      if (!data.barcode) data.barcode = canonical;
    }
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '',
      author: '',
      publisher: '',
      year: '',
      barcode: '',
      format: 'paperback',
      quantity: 1,
      pages: null,
      language: 'fr',
      series: '',
      volume: null,
      readingStatus: 'to_read',
      rating: 0,
      comments: '',
      location: '',
      cover_image: '/ressources/no_book.png',
      user_image: ''
    };
  },

  async refreshItem(item: any, req: any): Promise<Record<string, any>> {
    if (!item.hardcover_slug) {
      throw new Error('No Hardcover Slug to refresh');
    }

    const apiKey = process.env.HARDCOVER_API_KEY;
    const graphqlQuery = {
      query: `query bookBySlug($slug: String!) {
        books(where: { slug: { _eq: $slug } }, limit: 1) {
          id
          slug
          title
          description
          cached_contributors
          release_year
          pages
          image { url }
          taggings {
            tag { tag }
          }
          editions(limit: 5, order_by: { users_count: desc }) {
            isbn_13
            isbn_10
            publisher { name }
            language { language }
            pages
            reading_format_id
          }
        }
      }`,
      variables: { slug: item.hardcover_slug }
    };

    const dataRes = await fetchJson('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: {
        'Authorization': apiKey?.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(graphqlQuery)
    });

    if (dataRes.errors) {
      console.error("[ERR] Hardcover GraphQL:", dataRes.errors);
      throw new Error(dataRes.errors[0]?.message || 'GraphQL Error');
    }

    const bookData = dataRes?.data?.books?.[0];
    if (!bookData) {
      throw new Error('Not found on Hardcover API');
    }

    const provider = new HardcoverProvider();
    const formatted = (provider as any).formatHardcoverBook(bookData);
    if (!formatted) {
      throw new Error('Formatting failed');
    }

    return {
      cover_image: formatted.cover_image,
      description: formatted.description,
      genres: formatted.genres,
      genre: formatted.genres[0] || '',
      pages: formatted.pages,
      language: formatted.language,
      isbn: item.barcode_locked ? item.isbn : formatted.isbn,
      barcode: item.barcode_locked ? item.barcode : formatted.isbn,
      publisher: formatted.publisher
    };
  }
};

export default booksPlugin;
