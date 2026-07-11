import mongoose from 'mongoose';
import { PluginImporter } from '../../core/types';
import { fetchJson, fetchText } from '../../core/helpers';
import Item from '../../models/Item';

function parseRssXml(xmlText: string): any[] {
  const items: any[] = [];
  const itemMatches = xmlText.match(/<item>([\s\S]*?)<\/item>/g);
  if (!itemMatches) return items;

  const getTagValue = (xmlStr: string, tagName: string): string => {
    const match = xmlStr.match(new RegExp(`<${tagName}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\/${tagName}>`));
    return (match && match[1]) ? match[1].trim() : '';
  };

  for (const itemXml of itemMatches) {
    const bookXmlMatch = itemXml.match(/<book>([\s\S]*?)<\/book>/);
    const numPages = (bookXmlMatch && bookXmlMatch[1]) ? getTagValue(bookXmlMatch[1], 'num_pages') : '';

    items.push({
      title: getTagValue(itemXml, 'title'),
      author_name: getTagValue(itemXml, 'author_name'),
      isbn13: getTagValue(itemXml, 'isbn13'),
      isbn: getTagValue(itemXml, 'isbn'),
      user_shelves: getTagValue(itemXml, 'user_shelves'),
      book_large_image_url: getTagValue(itemXml, 'book_large_image_url'),
      book_medium_image_url: getTagValue(itemXml, 'book_medium_image_url'),
      book: { num_pages: numPages },
      user_date_added: getTagValue(itemXml, 'user_date_added'),
      user_rating: getTagValue(itemXml, 'user_rating'),
      book_published: getTagValue(itemXml, 'book_published'),
      user_review: getTagValue(itemXml, 'user_review')
    });
  }

  return items;
}

// GOODREADS RSS IMPORT
async function importGoodreads(req: any, res: any) {
  const { rss_url, default_format, default_language } = req.body;
  if (!rss_url || !rss_url.includes('goodreads.com')) {
    return res.status(400).json({ error: "Invalid GoodReads RSS URL" });
  }

  const userId = req.user._id;
  const defaultFormat = default_format || 'paperback';
  const defaultLanguage = default_language || '';

  res.status(202).json({ success: true, message: "Import started" });

  try {
    const Book = mongoose.model('Book');
    let page = 1;
    let totalImported = 0;
    let totalFetched = 0;
    let hasMore = true;

    while (hasMore) {
      const url = `${rss_url}&shelf=%23ALL%23&per_page=200&page=${page}`;
      const xmlData = await fetchText(url, { signal: AbortSignal.timeout(15000) });
      const books = parseRssXml(xmlData);
      if (books.length === 0) break;
      totalFetched += books.length;

      for (const item of books) {
        const title = item['title']?.trim();
        const author = item['author_name']?.trim() || '';
        if (!title || !author) continue;

        const existing = await Item.findOne({ owner: userId, title, author, kind: 'Book' });
        if (existing) continue;

        const isbn = item['isbn13']?.trim() || item['isbn']?.trim() || '';

        const shelf = (item['user_shelves'] || '').toLowerCase();

        let readingStatus = 'read';
        if (shelf.includes('currently')) readingStatus = 'reading';
        else if (shelf.includes('to-read')) readingStatus = 'to_read';

        const hasAsianChars = /[　-鿿가-힯]/.test(title);
        let format = hasAsianChars ? 'manga' : defaultFormat;

        if (shelf.includes('manga')) format = 'manga';
        else if (shelf.includes('comic') || shelf.includes('bd')) format = 'comic';
        else if (shelf.includes('graphic')) format = 'graphic_novel';
        else if (shelf.includes('hardcover') || shelf.includes('relié')) format = 'hardcover';
        else if (shelf.includes('paperback') || shelf.includes('broché')) format = 'paperback';

        const cover_image = item['book_large_image_url']?.trim() || item['book_medium_image_url']?.trim() || '/ressources/no_book.png';

        const pages = parseInt(item['book']?.num_pages) || 0;

        const dateAdded = item['user_date_added']?.trim()
          ? new Date(item['user_date_added'].trim())
          : new Date();

        const rating = parseFloat(item['user_rating']) || 0;
        const year = item['book_published']?.trim() || '';

        let publisher = '';
        let language = defaultLanguage;

        if (isbn) {
          try {
            const olData = await fetchJson(
              `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
              { signal: AbortSignal.timeout(4000) }
            );
            const olBook = olData?.[`ISBN:${isbn}`];

            if (olBook) {
              publisher = olBook.publishers?.[0]?.name || '';

              const langKey = (olBook.languages?.[0]?.key || '').split('/').pop() || '';
              const langMap: Record<string, string> = {
                fre: 'fr', fra: 'fr',
                eng: 'en',
                spa: 'es',
                deu: 'de',
                ita: 'it',
                jpn: 'ja',
                por: 'pt',
                nld: 'nl',
                kor: 'ko',
                zho: 'zh',
              };
              language = langMap[langKey] || langKey || defaultLanguage;

              if (format === defaultFormat && !hasAsianChars) {
                const pub = publisher.toLowerCase();
                const mangaPublishers = [
                  'viz', 'kana', 'glénat manga', 'glenat manga',
                  'pika', 'ki-oon', 'kurokawa', 'delcourt manga',
                  'tonkam', 'shueisha', 'kodansha', 'square enix'
                ];
                const comicPublishers = [
                  'marvel', 'dc comics', 'image comics',
                  'dark horse', 'urban comics', 'panini comics'
                ];
                if (mangaPublishers.some(p => pub.includes(p))) format = 'manga';
                else if (comicPublishers.some(p => pub.includes(p))) format = 'comic';
              }
            }
          } catch (err: any) {
            console.error("Error fetching Open Library data:", err.message);
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        await Book.create({
          kind: 'Book',
          media_type: 'book',
          owner: userId,
          title,
          author,
          isbn,
          publisher,
          language,
          year,
          pages,
          format,
          rating,
          readingStatus,
          cover_image,
          source: 'goodreads',
          in_wishlist: false,
          comments: item['user_review']?.trim() || '',
          added_at: dateAdded,
          genre: '',
        });

        totalImported++;
        req.io.emit('import_progress', { current: totalImported, total: totalFetched });
      }

      if (books.length < 200) hasMore = false;
      else page++;
    }

    req.io.emit('import_finished', { count: totalImported });

  } catch (err: any) {
    console.error("[ERR] GoodReads RSS import:", err.message);
    req.io.emit('import_error', { message: err.message });
  }
}

export const booksImporters: PluginImporter[] = [
  {
    id: 'goodreads',
    requireAdmin: true,
    handler: importGoodreads,
    ui: {
      label: 'admin.goodreads.title',
      icon: 'fa-goodreads',
      description: 'admin.goodreads.subtitle',
      color: 'amber',
      help: ['admin.goodreads.step1', 'admin.goodreads.step2', 'admin.goodreads.step3', 'admin.goodreads.step4'],
      warning: 'admin.goodreads.warning_body',
      fields: [
        { name: 'default_format', label: 'admin.goodreads.default_format', type: 'select', default: 'paperback', hint: 'admin.goodreads.default_format_hint', options: [
          { value: 'paperback', label: 'format.paperback' },
          { value: 'hardcover', label: 'format.hardcover' },
          { value: 'manga', label: 'format.manga' },
          { value: 'comic', label: 'format.comic' },
          { value: 'graphic_novel', label: 'format.graphic_novel' }
        ] },
        { name: 'default_language', label: 'admin.goodreads.default_language', type: 'text', placeholder: 'fr, en, ja...', hint: 'admin.goodreads.default_language_hint' },
        { name: 'rss_url', label: 'admin.goodreads.rss_url_label', type: 'url', placeholder: 'https://www.goodreads.com/review/list_rss/...', required: true, hint: 'admin.goodreads.rss_url_hint' }
      ],
      submitLabel: 'admin.goodreads.btn_import'
    }
  }
];
