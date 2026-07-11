import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';
import { STANDARD_FORMAT_TERMS } from './constants';

export class DiscogsProvider implements SearchProvider {
  name = 'Discogs';

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const token = process.env.DISCOGS_TOKEN;
    let type = options.type || 'vinyl'; // 'vinyl', 'cd', 'cassette'
    if (!['vinyl', 'cd', 'cassette'].includes(type)) {
      type = 'vinyl';
    }
    // advancedCD is a music-scoped plugin setting; the provider is the only place that knows the key
    const enableAdvancedCD = !!(options.pluginSettings?.advancedCD ?? options.enableAdvancedCD);
    const year = options.year;
    const country = options.country;
    const genre_filter = options.genre_filter;
    const label_filter = options.label_filter;

    let searchUrls: string[] = [];
    let isDirectRelease = false;

    const urlMatch = query.match(/discogs\.com\/(?:[a-zA-Z]{2}\/)?(release|master)\/(\d+)/);

    if (urlMatch) {
      const itemType = urlMatch[1];
      const itemId = urlMatch[2];

      if (itemType === 'master') {
        searchUrls.push(`https://api.discogs.com/database/search?master_id=${itemId}&type=release&token=${token}`);
      } else if (itemType === 'release') {
        searchUrls.push(`https://api.discogs.com/releases/${itemId}?token=${token}`);
        isDirectRelease = true;
      }
    } else {
      let advancedParams = '';
      if (year) advancedParams += `&year=${encodeURIComponent(year)}`;
      if (country) advancedParams += `&country=${encodeURIComponent(country)}`;
      if (genre_filter) advancedParams += `&genre=${encodeURIComponent(genre_filter)}`;
      if (label_filter) advancedParams += `&label=${encodeURIComponent(label_filter)}`;

      if (type === 'cd' && enableAdvancedCD) {
        searchUrls.push(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=CD${advancedParams}&token=${token}`);
        searchUrls.push(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=SACD${advancedParams}&token=${token}`);
        searchUrls.push(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=CDr${advancedParams}&token=${token}`);
      } else {
        searchUrls.push(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=${type}${advancedParams}&token=${token}`);
      }
    }

    const headers: Record<string, string> = { 'User-Agent': 'DVinylApp/1.0' };
    if (token) {
      headers['Authorization'] = `Discogs token=${token}`;
    }

    const responses = await Promise.all(
      searchUrls.map(url => fetchJson(url, { headers }))
    );

    let allResults: any[] = [];
    if (isDirectRelease) {
      const r = responses[0]!;
      const mappedResult = {
        id: String(r.id),
        title: r.title,
        creator: r.artists ? r.artists.map((a: any) => a.name).join(', ') : 'Unknown',
        year: String(r.year || ''),
        country: r.country || '',
        cover_image: (r.images && r.images.length > 0) ? r.images[0].resource_url : r.thumb,
        formats: r.formats,
        format: r.formats && r.formats[0] ? [r.formats[0].name, ...(r.formats[0].descriptions || [])] : []
      };
      allResults.push(mappedResult);
    } else {
      responses.forEach((response, index) => {
        let results = response.results || [];
        if (!urlMatch && type === 'cd' && enableAdvancedCD) {
          if (index === 1) results = results.map((item: any) => ({ ...item, is_advanced_cd: 'sacd' }));
          else if (index === 2) results = results.map((item: any) => ({ ...item, is_advanced_cd: 'cdr' }));
        }
        allResults = allResults.concat(results);
      });
    }

    const technicalBlacklist = [
      'Vinyl', 'LP', 'Album', 'Reissue', 'Repress', 'Stereo', 'Gatefold',
      '12"', '7"', 'Limited Edition', 'Compilation', 'Deluxe Edition', 'Numbered', 'Promo'
    ];

    const uniqueIds = new Set();
    const deduplicatedResults: any[] = [];
    for (const item of allResults) {
      if (!uniqueIds.has(item.id)) {
        uniqueIds.add(item.id);
        deduplicatedResults.push(item);
      }
    }

    return deduplicatedResults.slice(0, 100).map(item => {
      let variant_info = '';

      if (item.formats && item.formats[0] && item.formats[0].text) {
        variant_info = item.formats[0].text.split(',')
          .map((p: string) => p.trim())
          .filter((part: string) => !technicalBlacklist.some(term => part.toLowerCase().includes(term.toLowerCase())))
          .join(', ');
      }

      let title = item.title;
      let creator = item.creator || 'Unknown';
      if (!isDirectRelease && title.includes(' - ')) {
        const parts = title.split(' - ');
        creator = parts[0]!.trim();
        title = parts.slice(1).join(' - ').trim();
      }

      return {
        id: String(item.id),
        title: title,
        creator: creator,
        artist: creator,
        year: String(item.year || ''),
        cover_image: item.cover_image || item.thumb || '/ressources/logo.png',
        variant_info: variant_info,
        is_advanced_cd: item.is_advanced_cd,
        country: item.country || ''
      };
    });
  }

  async getDetails(id: string, options: any): Promise<ConfirmData> {
    const token = process.env.DISCOGS_TOKEN;
    const searchTypeHint = options.type;
    const url = `https://api.discogs.com/releases/${id}?token=${token}`;
    const data = await fetchJson(url, { headers: { 'User-Agent': 'DVinylApp/1.0' } });

    let formatType: string[] = [];
    let variantColor: string[] = [];
    let finalMediaType = 'vinyl';

    if (data.formats && data.formats.length > 0) {
      let bestFormat = data.formats[0];
      if (searchTypeHint) {
        const hint = searchTypeHint.toLowerCase();
        const matched = data.formats.find((f: any) => f.name.toLowerCase().includes(hint));
        if (matched) bestFormat = matched;
      }

      formatType.push(bestFormat.name);

      if (bestFormat.text) {
        const parts = bestFormat.text.split(',').map((p: string) => p.trim());
        parts.forEach((part: string) => {
          if (STANDARD_FORMAT_TERMS.includes(part)) {
            if (!formatType.includes(part)) formatType.push(part);
          } else {
            if (!variantColor.includes(part)) variantColor.push(part);
          }
        });
      }

      if (bestFormat.descriptions) {
        bestFormat.descriptions.forEach((desc: string) => {
          if (STANDARD_FORMAT_TERMS.includes(desc)) {
            if (!formatType.includes(desc)) formatType.push(desc);
          } else {
            if (!variantColor.includes(desc)) {
              variantColor.push(desc);
            }
          }
        });
      }

      const rawFormat = bestFormat.name.toLowerCase();
      if (rawFormat.includes('cassette')) { finalMediaType = 'cassette'; }
      else if (rawFormat.includes('cd')) { finalMediaType = 'cd'; }
      else { finalMediaType = 'vinyl'; }
    }

    if (searchTypeHint) finalMediaType = searchTypeHint;

    let barcode = '';
    if (data.identifiers && data.identifiers.length > 0) {
      const barcodeObj = data.identifiers.find((id: any) => id.type === 'Barcode');
      if (barcodeObj) {
        barcode = barcodeObj.value.replace(/\s/g, '');
      }
    }

    const artist = data.artists ? data.artists.map((a: any) => a.name).join(', ') : 'Unknown';
    return {
      title: data.title,
      creator: artist,
      artist,
      year: data.year || '',
      label: data.labels && data.labels.length > 0 ? data.labels[0].name : '',
      catalog_number: data.labels && data.labels.length > 0 ? data.labels[0].catno : '',
      format_type: formatType.join(', '),
      variant_color: variantColor.join(', '),
      tracklist: data.tracklist || [],
      cover_image: data.images && data.images.length > 0 ? data.images[0].resource_url : '',
      discogs_id: data.id,
      country: data.country || '',
      genres: data.genres || [],
      styles: data.styles || [],
      barcode: barcode,
      media_type: finalMediaType
    };
  }
}
