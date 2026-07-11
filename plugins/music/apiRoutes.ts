import { PluginApiRoute } from '../../core/types';
import { getAdminId } from '../../core/helpers';
import Item from '../../models/Item';

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
    const adminId = await getAdminId();
    const albums = await Item.find({
      owner: adminId,
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
          { discogs_id: parseInt(discogsId), kind: 'Music' },
          { $set: { barcode: barcode, barcode_locked: true } }
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


export const musicApiRoutes: PluginApiRoute[] = [
  { method: 'get', path: '/api/collection/ids', handler: getCollectionIds },
  { method: 'get', path: '/api/estimate/:discogsId', handler: getEstimate },
  { method: 'get', path: '/api/search-discogs-gallery', requireAdmin: true, handler: searchDiscogsGallery },
  { method: 'post', path: '/api/batch-update-barcodes', requireAdmin: true, handler: batchUpdateBarcodes }
];
