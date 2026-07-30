import { PluginImporter } from '../../core/types';
import { fetchJson, escapeRegExp, parseCsv } from '../../core/helpers';
import { CsvImportContext, CsvRow, runCsvImport } from '../../core/csvImport';
import { registry } from '../../core/registry';
import {
  LIBIB_HELP_STEPS, LIBIB_REQUIRED_COLUMNS, LIBIB_TYPE_MUSIC, libibAddedAt, libibBarcode,
  libibComments, libibCreator, libibImportFields, libibPrice, libibQuantity, libibTags,
  libibTypeFilter, libibYear
} from '../../utils/libib';
import Item from '../../models/Item';
import User from '../../models/User';
import { STANDARD_FORMAT_TERMS } from './constants';

// DISCOGS COLLECTION/WISHLIST IMPORT ROUTE
async function importDiscogs(req: any, res: any) {
  const { discogsUrl, full, type } = req.body;
  const userId = req.user._id;
  const activeCollectionId = res.locals.activeCollectionId;
  const token = process.env.DISCOGS_TOKEN;

  // The URL is provided by the admin import form; the collection "sync" button omits it and
  // relies on the username already stored from a previous import (pluginData.music.discogsUsername).
  let username: string | undefined;
  if (discogsUrl) {
    const usernameMatch = (discogsUrl as string).match(/(?:user\/|user=)([^/?&]+)/);
    if (!usernameMatch) return res.status(400).json({ error: "Invalid Discogs URL" });
    username = usernameMatch[1];
  } else {
    const u = await User.findById(userId).select('pluginData').lean() as any;
    username = u?.pluginData?.music?.discogsUsername;
  }
  if (!username) return res.status(400).json({ error: "Invalid Discogs URL" });

  await User.findByIdAndUpdate(userId, { $set: { 'pluginData.music.discogsUsername': username } });

  res.status(202).json({ success: true, message: "Import started" });

  try {
    let page = 1;
    let totalImported = 0;
    let totalProcessed = 0;
    let hasMore = true;

    const isWishlist = (type === 'wishlist');
    const apiUrl = isWishlist ? `https://api.discogs.com/users/${username}/wants` : `https://api.discogs.com/users/${username}/collection/folders/0/releases`;
    const listKey = isWishlist ? 'wants' : 'releases';

    while (hasMore) {
      const params = new URLSearchParams({ page: page.toString(), per_page: '50' });
      const data = await fetchJson(`${apiUrl}?${params}`, {
        headers: { 'Authorization': `Discogs token=${token}`, 'User-Agent': 'DVinylApp/1.0' }
      });

      const listItems = data[listKey];
      const pagination = data.pagination;

      if (!listItems || listItems.length === 0) break;

      const albumsToInsert: any[] = [];

      for (const item of listItems) {
        const info = item.basic_information;
        // Scoped to the list being imported: a release owned in the collection must not
        // cancel its wantlist entry, exactly as Discogs keeps the two lists apart.
        // Items predating the in_wishlist field count as owned.
        const existing = await Item.findOne({
          discogs_id: info.id,
          collection: activeCollectionId,
          in_wishlist: isWishlist ? true : { $ne: true }
        }) as any;

        if (existing) {
          if (full === true && (!existing.tracklist || existing.tracklist.length === 0)) {
            try {
              console.log(`🔄 Updating tracklist for existing album ID ${info.id}`);
              const detailData = await fetchJson(`https://api.discogs.com/releases/${info.id}`, {
                headers: { 'Authorization': `Discogs token=${token}`, 'User-Agent': 'DVinylApp/2.0' }
              });
              const fetchedTracklist = detailData.tracklist || [];

              if (fetchedTracklist.length > 0) {
                await Item.updateOne(
                  { _id: existing._id },
                  { $set: { tracklist: fetchedTracklist } },
                  { strict: false }
                );
              }
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) {
              console.error(`Tracklist update error ID ${info.id}`);
            }
          }

          totalProcessed++;
          req.io.emit('import_progress', { current: totalProcessed, total: pagination.items });
          continue;
        }

        let tracklist: any[] = [];
        if (full === true) {
          try {
            const detailData = await fetchJson(`https://api.discogs.com/releases/${info.id}`, {
              headers: { 'Authorization': `Discogs token=${token}`, 'User-Agent': 'DVinylApp/1.0' }
            });
            tracklist = detailData.tracklist || [];
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (e) { console.error(`Tracklist error ID ${info.id}`); }
        }

        let formatType = [info.formats?.[0]?.name].filter(Boolean);
        let variantColor: string[] = [];
        const firstFormat = info.formats?.[0];
        if (firstFormat) {
          if (firstFormat.text) {
            const parts = firstFormat.text.split(',').map((p: string) => p.trim());
            parts.forEach((part: string) => {
              if (STANDARD_FORMAT_TERMS.includes(part)) {
                if (!formatType.includes(part)) formatType.push(part);
              } else {
                if (!variantColor.includes(part)) variantColor.push(part);
              }
            });
          }
          if (firstFormat.descriptions) {
            firstFormat.descriptions.forEach((d: string) => {
              if (STANDARD_FORMAT_TERMS.includes(d)) {
                if (!formatType.includes(d)) formatType.push(d);
              } else {
                if (!variantColor.includes(d)) variantColor.push(d);
              }
            });
          }
        }
        const rawFormat = info.formats?.[0]?.name.toLowerCase() || 'vinyl';
        const mediaType = rawFormat.includes('cd') ? 'cd' : (rawFormat.includes('cassette') ? 'cassette' : 'vinyl');

        albumsToInsert.push({
          title: info.title,
          artist: info.artists.map((a: any) => a.name).join(', '),
          year: info.year || 0,
          label: info.labels?.[0]?.name || 'Unknown',
          catalog_number: info.labels?.[0]?.catno || '',
          format_type: formatType.join(', '),
          variant_color: variantColor.join(', '),
          media_type: mediaType,
          cover_image: info.cover_image || info.thumb || '',
          tracklist,
          discogs_id: info.id,
          owner: userId,
          collection: activeCollectionId,
          added_at: new Date(),
          location: '',
          genre: info.genres?.[0] || '',
          genres: info.genres || [],
          styles: info.styles || [],
          in_wishlist: isWishlist,
          kind: 'Music'
        });

        totalProcessed++;
        req.io.emit('import_progress', { current: totalProcessed, total: pagination.items });
      }

      if (albumsToInsert.length > 0) {
        await Item.insertMany(albumsToInsert);
        totalImported += albumsToInsert.length;
      }

      if (page >= pagination.pages) hasMore = false;
      else page++;
    }

    req.io.emit('import_finished', { count: totalImported });
  } catch (err: any) {
    req.io.emit('import_error', { message: err.message });
  }
}

// MUSIK-SAMMLER CSV IMPORT ROUTE
async function importMusikSammler(req: any, res: any) {
  const { csv, type } = req.body;
  const userId = req.user._id;
  const activeCollectionId = res.locals.activeCollectionId;

  if (!csv) {
    return res.status(400).json({ error: "Missing CSV data" });
  }

  res.status(202).json({ success: true, message: "Import started" });

  try {
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      req.io.emit('import_error', { message: "CSV file is empty or invalid" });
      return;
    }

    const cleanHeader = (h: string) => h.replace(/^\uFEFF/, '').trim();
    const headerRow = rows[0];
    if (!headerRow) {
      req.io.emit('import_error', { message: "CSV file is empty or invalid" });
      return;
    }
    const headers = headerRow.map(cleanHeader);

    const artistIndex = headers.indexOf('Künstler/Band');
    const countryIndex = headers.indexOf('Land');
    const titleIndex = headers.indexOf('Albumtitel');
    const typeIndex = headers.indexOf('Typ');
    const barcodeIndex = headers.indexOf('EAN/UPC');
    const labelIndex = headers.indexOf('Label');
    const catnoIndex = headers.indexOf('Katalognummer');
    const yearReleaseIndex = headers.indexOf('Veröffentlichungsjahr Tonträger');
    const yearAlbumIndex = headers.indexOf('Veröffentlichungsjahr Album');
    const mfgCountryIndex = headers.indexOf('Herstellungsland');
    const genreIndex = headers.indexOf('Genre');
    const subgenresIndex = headers.indexOf('Untergenres');
    const featuresIndex = headers.indexOf('Besonderheiten');
    const infoIndex = headers.indexOf('Zusatzinformationen');
    const priceIndex = headers.indexOf('Kaufpreis');
    const dateIndex = headers.indexOf('Kaufdatum');
    const locationIndex = headers.indexOf('Kauf-Ort');
    const commentIndex = headers.indexOf('Kommentar');
    const linkCoverIndex = headers.indexOf('Link zum Cover');
    const songsIndex = headers.indexOf('Songtitel');

    if (titleIndex === -1 || artistIndex === -1) {
      req.io.emit('import_error', { message: "Invalid CSV format: Künstler/Band or Albumtitel header missing." });
      return;
    }

    const isWishlist = (type === 'wishlist');
    let totalImported = 0;
    let totalProcessed = 0;
    const totalItems = rows.length - 1;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < 2) continue;

      const title = row[titleIndex]?.trim();
      // A blank artist column defaults to "Unknown" rather than dropping the row.
      const artist = row[artistIndex]?.trim() || 'Unknown';
      if (!title) {
        totalProcessed++;
        continue;
      }

      // Check if duplicate (case-insensitive, like the pre-refactor import), within the
      // list being targeted: the wishlist and the collection are two separate lists, so
      // an album already owned must not cancel its wishlist entry (and vice versa).
      // Items predating the in_wishlist field count as owned.
      const existing = await Item.findOne({
        collection: activeCollectionId,
        in_wishlist: isWishlist ? true : { $ne: true },
        title: new RegExp(`^${escapeRegExp(title)}$`, 'i'),
        artist: new RegExp(`^${escapeRegExp(artist)}$`, 'i')
      }) as any;
      if (existing) {
        totalProcessed++;
        req.io.emit('import_progress', { current: totalProcessed, total: totalItems });
        continue;
      }

      const year = parseInt(row[yearReleaseIndex] || row[yearAlbumIndex] || '') || 0;
      const label = row[labelIndex]?.trim() || 'Unknown';
      const catalog_number = row[catnoIndex]?.trim() || '';
      const barcode = (row[barcodeIndex] || '').replace(/\s/g, '');
      const rawMediaType = (row[typeIndex] || '').toLowerCase();
      const media_type = rawMediaType.includes('cd') ? 'cd' : (rawMediaType.includes('cassette') ? 'cassette' : 'vinyl');
      const format_type = row[typeIndex]?.trim() || 'Vinyl';
      const variant_color = featuresIndex > -1 ? row[featuresIndex]?.trim() : '';

      // Comments compilation
      let commentsParts = [];
      const customComment = commentIndex > -1 ? row[commentIndex]?.trim() : '';
      if (customComment) {
        commentsParts.push(customComment);
      }
      const addInfo = infoIndex > -1 ? row[infoIndex]?.trim() : '';
      if (addInfo) {
        commentsParts.push(`Zusatzinfo: ${addInfo}`);
      }
      const price = priceIndex > -1 ? row[priceIndex]?.trim() : '';
      const date = dateIndex > -1 ? row[dateIndex]?.trim() : '';
      const buyPlace = locationIndex > -1 ? row[locationIndex]?.trim() : '';

      let purchaseInfo = [];
      if (price && price !== '0.00' && price !== '0') purchaseInfo.push(`${price} €`);
      if (date) purchaseInfo.push(date);
      if (buyPlace) purchaseInfo.push(buyPlace);

      if (purchaseInfo.length > 0) {
        commentsParts.push(`Achat: ${purchaseInfo.join(' - ')}`);
      }
      const comments = commentsParts.join('\n\n');

      const cover_image = linkCoverIndex > -1 ? row[linkCoverIndex]?.trim() : '';

      const mainGenre = genreIndex > -1 ? row[genreIndex]?.trim() : '';
      const subGenresRaw = subgenresIndex > -1 ? row[subgenresIndex]?.trim() : '';
      const parsedSubgenres = subGenresRaw ? subGenresRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

      const genres = [mainGenre].filter(Boolean);
      const styles = parsedSubgenres;
      const genre = mainGenre || '';

      // Tracklist parsing
      const tracklist = [];
      if (songsIndex > -1 && songsIndex < row.length) {
        let trackNum = 1;
        for (let s = songsIndex; s < row.length; s++) {
          const rawSong = row[s]?.trim();
          if (!rawSong) continue;

          if (s === songsIndex && /^\d+$/.test(rawSong)) {
            continue;
          }

          const match = rawSong.match(/^(.*?)\s*\((\d{2}:\d{2}:\d{2}|\d{2}:\d{2})\)$/);
          let sTitle = rawSong;
          let sDuration = '';
          if (match) {
            sTitle = match[1]!.trim();
            sDuration = match[2]!.trim();
          }

          tracklist.push({
            position: trackNum.toString(),
            title: sTitle,
            duration: sDuration
          });
          trackNum++;
        }
      }

      await Item.create({
        title,
        artist,
        year,
        label,
        catalog_number,
        format_type,
        variant_color,
        cover_image,
        tracklist,
        media_type,
        in_wishlist: isWishlist,
        owner: userId,
        collection: activeCollectionId,
        comments,
        location: '',
        genre,
        genres,
        styles,
        barcode,
        kind: 'Music',
        added_at: new Date()
      });

      totalImported++;
      totalProcessed++;
      req.io.emit('import_progress', { current: totalProcessed, total: totalItems });
    }

    req.io.emit('import_finished', { count: totalImported });
  } catch (err: any) {
    console.error("Musik-Sammler import error:", err);
    req.io.emit('import_error', { message: err.message });
  }
}

// LIBIB CSV IMPORT (music rows of the export)
async function importLibibMusic(req: any, res: any) {
  // Read from the registry rather than importing index.ts, which imports this file.
  const plugin = registry.get('music')!;

  const FORMAT_LABELS: Record<string, string> = {
    vinyl: 'Vinyl', cd: 'CD', cassette: 'Cassette', digital: 'Digital'
  };

  return runCsvImport(req, res, {
    plugin,
    requiredColumns: LIBIB_REQUIRED_COLUMNS,
    accepts: libibTypeFilter(LIBIB_TYPE_MUSIC),
    searchQuery: (_row: CsvRow, data: Record<string, any>) => [data.artist, data.title].filter(Boolean).join(' '),
    // Discogs filters its search by support and falls back to vinyl: without this, a
    // CD or cassette library would be looked up among vinyl releases only.
    searchOptions: (_row: CsvRow, data: Record<string, any>) => ({ type: data.media_type }),
    mapRow(row: CsvRow, ctx: CsvImportContext) {
      const title = (row['title'] || '').trim();
      if (!title) return null;

      // Libib exports no support at all, so the whole file lands on the format the
      // admin picked in the modal.
      const mediaType = ctx.body.default_format || 'vinyl';
      const discs = parseInt(row['number_of_discs'] || '', 10) || 1;
      const formatLabel = FORMAT_LABELS[mediaType] || 'Vinyl';
      const { genre, genres } = libibTags(row);

      return {
        title,
        artist: libibCreator(row) || 'Unknown',
        label: (row['publisher'] || '').trim() || 'Unknown',
        year: libibYear(row),
        barcode: libibBarcode(row),
        media_type: mediaType,
        format_type: discs > 1 ? `${discs}x${formatLabel}` : formatLabel,
        genre,
        genres,
        // Music has no description path: the Libib blurb is kept in the comments
        // rather than dropped.
        comments: libibComments(row, [
          { label: ctx.req.t('admin.libib.note_price'), value: libibPrice(row) },
          { label: ctx.req.t('admin.libib.note_description'), value: (row['description'] || '').trim() }
        ]),
        added_at: libibAddedAt(row),
        quantity: libibQuantity(row)
      };
    }
  });
}

export const musicImporters: PluginImporter[] = [
  {
    id: 'discogs',
    handler: importDiscogs,
    ui: {
      label: 'admin.import.title',
      icon: 'fa-record-vinyl',
      description: 'admin.import.subtitle',
      color: 'primary',
      fields: [
        { name: 'discogsUrl', label: 'admin.import.url_label', type: 'url', placeholder: 'https://www.discogs.com/user/...', required: true, hint: 'admin.import.url_hint' },
        { name: 'type', label: 'admin.import.type_label', type: 'select', default: 'collection', options: [
          { value: 'collection', label: 'admin.import.collection' },
          { value: 'wishlist', label: 'admin.import.wantlist' }
        ] },
        { name: 'full', label: 'admin.import.full_label', type: 'select', default: 'false', options: [
          { value: 'false', label: 'admin.import.mode_fast' },
          { value: 'true', label: 'admin.import.mode_full' }
        ], hint: 'admin.import.full_hint' }
      ],
      submitLabel: 'admin.import.btn_start'
    }
  },
  {
    id: 'musik-sammler',
    requireAdmin: true,
    handler: importMusikSammler,
    ui: {
      label: 'admin.musiksammler.title',
      icon: 'fa-file-csv',
      description: 'admin.musiksammler.subtitle',
      color: 'emerald',
      fields: [
        { name: 'csv', label: 'admin.musiksammler.file_label', type: 'file', accept: '.csv', fileEncoding: 'text', required: true },
        { name: 'type', label: 'admin.import.type_label', type: 'select', default: 'collection', options: [
          { value: 'collection', label: 'admin.import.collection' },
          { value: 'wishlist', label: 'admin.import.wantlist' }
        ] }
      ],
      submitLabel: 'admin.musiksammler.btn_import'
    }
  },
  {
    id: 'libib-music',
    requireAdmin: true,
    handler: importLibibMusic,
    ui: {
      label: 'admin.libib.title_music',
      icon: 'fa-file-csv',
      description: 'admin.libib.subtitle_music',
      color: 'emerald',
      help: LIBIB_HELP_STEPS,
      fields: libibImportFields({
        name: 'default_format', label: 'admin.libib.default_format', type: 'select', default: 'vinyl', hint: 'admin.libib.default_format_hint', options: [
          { value: 'vinyl', label: 'media.vinyl' },
          { value: 'cd', label: 'media.cd' },
          { value: 'cassette', label: 'media.cassette' },
          { value: 'digital', label: 'media.digital' }
        ]
      }),
      submitLabel: 'admin.libib.btn_import'
    }
  }
];
