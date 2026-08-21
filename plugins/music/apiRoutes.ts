import mongoose from 'mongoose';
import { PluginApiRoute } from '../../core/types';
import Item from '../../models/Item';
import PriceHistory from '../../models/PriceHistory';
import { editStamp } from '../../core/helpers';

const fetchJson = async (url: string, options?: RequestInit): Promise<any> => {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
};

// GET ALL COLLECTION DISCOGS IDs (used for global estimates)
async function getCollectionIds(req: any, res: any) {
  try {
    const albums = await Item.find({
      collection: res.locals.activeCollectionId,
      in_wishlist: false,
      $or: [{ kind: 'Music' }, { kind: { $exists: false } }]
    }).select('discogs_id quantity').lean();

    console.log(`📦 Global estimate: ${albums.length} albums sent to front-end.`);
    res.json({ success: true, albums });
  } catch (err: any) {
    console.error("API Collection IDs error:", err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
}

// ESTIMATE ROUTE (Discogs API)
async function getEstimate(req: any, res: any) {
  try {
    const discogsId = req.params.discogsId;
    const token = process.env.DISCOGS_TOKEN;
    const userCurrency = res.locals.user.currency || 'USD';

    // PLAN A: Active marketplace prices
    try {
      const statsRes = await fetch(`https://api.discogs.com/marketplace/stats/${discogsId}?curr_abbr=${userCurrency}&token=${token}`, {
        headers: { 'User-Agent': 'DVinylApp/1.0' }
      });

      if (statsRes.ok) {
        const statsData = await statsRes.json() as any;

        // Verify there's a non-zero lowest price
        if (statsData.lowest_price && statsData.lowest_price.value > 0) {
          return res.json({
            success: true,
            source: 'market',
            price: statsData.lowest_price,
            details: `${statsData.num_for_sale} ${req.t('detail.for_sale')}`
          });
        }
      }
    } catch (e) {
      // ignore
    }

    // PLAN B: Price suggestions / historical fallback
    try {
      const suggRes = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${discogsId}?token=${token}`, {
        headers: { 'User-Agent': 'DVinylApp/1.0' }
      });

      if (suggRes.ok) {
        const suggData = await suggRes.json() as any;
        const keys = Object.keys(suggData);

        const condition = ((req.query.condition as string) || '').toUpperCase();
        let targetKey = '';

        if (condition && condition !== 'GENERIC') {
          if (condition === 'M') {
            targetKey = keys.find(k => k.toLowerCase().includes('mint (m)')) || '';
          } else if (condition === 'NM') {
            targetKey = keys.find(k => k.toLowerCase().includes('near mint')) || '';
          } else if (condition === 'VG+') {
            targetKey = keys.find(k => k.toLowerCase().includes('very good plus')) || '';
          } else if (condition === 'VG') {
            targetKey = keys.find(k => k.toLowerCase().includes('very good (vg)')) || '';
          } else if (condition === 'G+') {
            targetKey = keys.find(k => k.toLowerCase().includes('good plus')) || '';
          } else if (condition === 'G') {
            targetKey = keys.find(k => k.toLowerCase().includes('good (g)')) || '';
          } else if (condition === 'F') {
            targetKey = keys.find(k => k.toLowerCase().includes('fair (f)')) || '';
          } else if (condition === 'P') {
            targetKey = keys.find(k => k.toLowerCase().includes('poor (p)')) || '';
          }
        }

        if (!targetKey) {
          const vgKey = keys.find(k => k.toLowerCase().includes('very good plus'));
          const mintKey = keys.find(k => k.toLowerCase().includes('mint (m)'));
          targetKey = vgKey || mintKey || keys[0] || '';
        }

        const bestPrice = targetKey ? suggData[targetKey] : null;

        if (bestPrice && bestPrice.value > 0) {
          let gradeLabel = 'VG+';
          if (targetKey.toLowerCase().includes('near mint')) gradeLabel = 'NM';
          else if (targetKey.toLowerCase().includes('mint (m)')) gradeLabel = 'M';
          else if (targetKey.toLowerCase().includes('very good (vg)')) gradeLabel = 'VG';
          else if (targetKey.toLowerCase().includes('good plus')) gradeLabel = 'G+';
          else if (targetKey.toLowerCase().includes('good (g)')) gradeLabel = 'G';
          else if (targetKey.toLowerCase().includes('fair (f)')) gradeLabel = 'F';
          else if (targetKey.toLowerCase().includes('poor (p)')) gradeLabel = 'P';

          return res.json({
            success: true,
            source: 'history',
            price: bestPrice,
            details: `Based on historical data (${gradeLabel})`
          });
        }
      }
    } catch (e) {
      // ignore
    }

    res.json({ success: false, error: "Unavailable" });
  } catch (err: any) {
    console.error("Estimation server error:", err.message);
    res.json({ success: false, error: "Server error" });
  }
}

// SAVE A COLLECTION VALUE SNAPSHOT (called client-side after the Estimate modal finishes)
async function saveEstimateSnapshot(req: any, res: any) {
  try {
    const { value, minValue, maxValue, currency, itemCount } = req.body || {};

    if (
      typeof value !== 'number' || typeof minValue !== 'number' ||
      typeof maxValue !== 'number' || typeof currency !== 'string' ||
      typeof itemCount !== 'number'
    ) {
      return res.status(400).json({ success: false, error: 'invalid_payload' });
    }

    await PriceHistory.create({
      collection: res.locals.activeCollectionId,
      value,
      minValue,
      maxValue,
      currency,
      itemCount
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('[ERR] saveEstimateSnapshot:', err.message);
    res.status(500).json({ success: false, error: 'server_error' });
  }
}

// COLLECTION VALUE HISTORY (chart data source)
async function getEstimateHistory(req: any, res: any) {
  try {
    const snapshots = await PriceHistory.find({ collection: res.locals.activeCollectionId })
      .sort({ capturedAt: 1 })
      .select('capturedAt value minValue maxValue currency itemCount -_id')
      .lean();

    res.json({ success: true, snapshots });
  } catch (err: any) {
    console.error('[ERR] getEstimateHistory:', err.message);
    res.status(500).json({ success: false, error: 'server_error' });
  }
}


// DISCOGS IMAGE GALLERY (secondary "disc" image search in the item editor)
async function searchDiscogsGallery(req: any, res: any) {
  try {
    let { q } = req.query;
    q = typeof q === 'string' ? q.trim() : '';
    const headers = {
      'User-Agent': 'DVinylApp/2.0',
      Authorization: `Discogs token=${process.env.DISCOGS_TOKEN || ''}`,
    };

    const searchRes = await fetchJson(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&per_page=3`,
      { headers }
    );
    const results = searchRes.results || [];
    const galleryPromises = results.map(async (item: any) => {
      try {
        const detail = await fetchJson(`https://api.discogs.com/releases/${item.id}`, { headers });
        return (detail.images || []).map((img: any) => img.resource_url);
      } catch (e) {
        return [];
      }
    });

    const allGalleries = await Promise.all(galleryPromises);
    const finalImages = [...new Set(allGalleries.flat())];
    res.json(finalImages);
  } catch (err: any) {
    console.error('[ERR] Discogs Global Gallery:', err.message);
    res.status(500).json({ error: 'ERROR Discogs search' });
  }
}

// BULK BARCODE ↔ DISCOGS_ID TOOL (admin utility)
async function batchUpdateBarcodes(req: any, res: any) {
  try {
    const { barcodeList } = req.body;
    if (!barcodeList) return res.redirect('/admin?msg=error');

    const lines = barcodeList
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.includes(':'));
    let count = 0;

    for (const line of lines) {
      const [discogsId, barcode] = line.split(':').map((s: string) => s.trim());
      if (discogsId && barcode) {
        const result = await Item.updateMany(
          { discogs_id: parseInt(discogsId), kind: 'Music', collection: res.locals.activeCollectionId },
          { $set: { barcode: barcode, barcode_locked: true, ...editStamp(req.user._id) } }
        );
        count += result.modifiedCount;
      }
    }

    res.redirect(`/admin?msg=batch_barcode_success&count=${count}`);
  } catch (err) {
    console.error('[ERR] batch-update-barcodes', err);
    res.redirect('/admin?msg=error');
  }
}


// PER-TRACK USER METADATA (rating, tags, notes, bpm, key)
async function updateTrackMeta(req: any, res: any) {
  try {
    const { id, trackId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(trackId)) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    const set: Record<string, any> = {};
    const unset: Record<string, any> = {};
    const body = req.body || {};

    if ('rating' in body) {
      const rating = Number(body.rating);
      if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
        return res.status(400).json({ success: false, error: 'Invalid rating' });
      }
      if (rating === 0) unset['tracklist.$.rating'] = 1;
      else set['tracklist.$.rating'] = rating;
    }
    if ('bpm' in body) {
      const bpm = Number(body.bpm);
      if (body.bpm === '' || body.bpm === null) unset['tracklist.$.bpm'] = 1;
      else if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 1000) {
        return res.status(400).json({ success: false, error: 'Invalid bpm' });
      } else set['tracklist.$.bpm'] = bpm;
    }
    if ('key' in body) set['tracklist.$.key'] = String(body.key || '').slice(0, 20);
    if ('notes' in body) set['tracklist.$.notes'] = String(body.notes || '').slice(0, 2000);
    if ('lyrics' in body) {
      const lyrics = String(body.lyrics || '').trim().slice(0, 20000);
      if (lyrics) set['tracklist.$.lyrics'] = lyrics;
      else unset['tracklist.$.lyrics'] = 1; // emptying the field clears the cache too
    }
    if ('tags' in body) {
      const tags = Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(',');
      set['tracklist.$.tags'] = tags
        .map((t: any) => String(t).trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 20);
    }

    const update: any = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }
    // Rating, key, notes and the rest are typed in by hand, so they count as an edit of
    // the item that carries the track.
    update.$set = { ...(update.$set || {}), ...editStamp(req.user._id) };

    const result = await Item.updateOne(
      { _id: id, collection: res.locals.activeCollectionId, kind: 'Music', 'tracklist._id': trackId },
      update
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('[ERR] track meta update:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
}

// TRACK LYRICS (lyrics.ovh, best effort, cached on the track subdocument)
async function getTrackLyrics(req: any, res: any) {
  try {
    const { id, trackId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(trackId)) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    const item: any = await Item.findOne(
      { _id: id, collection: res.locals.activeCollectionId, kind: 'Music', 'tracklist._id': trackId },
      { artist: 1, 'tracklist.$': 1 }
    ).lean();
    const track = item?.tracklist?.[0];
    if (!track) return res.status(404).json({ success: false, error: 'Not found' });

    if (track.lyrics) {
      return res.json({ success: true, lyrics: track.lyrics, cached: true });
    }

    // Discogs disambiguates homonym artists with a trailing "(2)"; lyrics.ovh won't know it
    const artist = String(item.artist || '').replace(/\s*\(\d+\)\s*$/, '').trim();
    const title = String(track.title || '').trim();
    if (!artist || !title) return res.json({ success: false, error: 'not_found' });

    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return res.json({ success: false, error: 'not_found' });

    const data: any = await response.json();
    const lyrics = String(data.lyrics || '').trim();
    if (!lyrics) return res.json({ success: false, error: 'not_found' });

    // The filter needs `kind` so Mongoose casts against the Music discriminator
    // schema. Without it, the base Item schema (which has no `tracklist` path)
    // silently strips the $set under strict mode.
    await Item.updateOne(
      { _id: id, kind: 'Music', 'tracklist._id': trackId },
      { $set: { 'tracklist.$.lyrics': lyrics } }
    );
    res.json({ success: true, lyrics });
  } catch (err: any) {
    // lyrics.ovh is a community service and flaky: report as a soft miss, never a 500
    console.error('[ERR] lyrics fetch:', err.message);
    res.json({ success: false, error: 'unavailable' });
  }
}

export const musicApiRoutes: PluginApiRoute[] = [
  { method: 'get', path: '/api/collection/ids', handler: getCollectionIds },
  { method: 'post', path: '/api/album/:id/track/:trackId/meta', requireEditor: true, handler: updateTrackMeta },
  { method: 'get', path: '/api/album/:id/track/:trackId/lyrics', handler: getTrackLyrics },
  { method: 'get', path: '/api/estimate/history', handler: getEstimateHistory },
  { method: 'get', path: '/api/estimate/:discogsId', handler: getEstimate },
  { method: 'post', path: '/api/estimate/snapshot', handler: saveEstimateSnapshot },
  { method: 'get', path: '/api/search-discogs-gallery', requireAdmin: true, handler: searchDiscogsGallery },
  { method: 'post', path: '/api/batch-update-barcodes', requireAdmin: true, handler: batchUpdateBarcodes }
];
