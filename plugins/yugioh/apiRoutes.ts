import { PluginApiRoute } from '../../core/types';
import Item from '../../models/Item';
import { fetchYgoprodeckCard } from './ygoprodeck';

async function getCollectionIds(req: any, res: any) {
  try {
    const items = await Item.find({
      collection: res.locals.activeCollectionId,
      in_wishlist: false,
      kind: 'Yugioh'
    }).select('ygo_card_id quantity').lean();
    res.json({ success: true, albums: items });
  } catch (err: any) {
    console.error('API Yu-Gi-Oh Collection IDs error:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
}

async function getEstimate(req: any, res: any) {
  try {
    const [numericId] = String(req.params.cardId).split('::');
    const card = await fetchYgoprodeckCard(numericId!);
    const prices = card.card_prices?.[0] || {};

    const chain: Array<[string, string]> = [
      ['tcgplayer_price', 'USD'],
      ['cardmarket_price', 'EUR'],
      ['ebay_price', 'USD'],
      ['amazon_price', 'USD'],
      ['coolstuffinc_price', 'USD']
    ];

    for (const [key, currency] of chain) {
      const raw = (prices as any)[key];
      const value = raw ? parseFloat(raw) : 0;
      if (value > 0) {
        return res.json({ success: true, source: 'ygoprodeck', price: { value, currency }, details: key });
      }
    }
    res.json({ success: false, error: 'Unavailable' });
  } catch (err: any) {
    console.error('Yu-Gi-Oh estimation server error:', err.message);
    res.json({ success: false, error: 'Server error' });
  }
}

export const yugiohApiRoutes: PluginApiRoute[] = [
  { method: 'get', path: '/api/yugioh/collection/ids', handler: getCollectionIds },
  { method: 'get', path: '/api/yugioh/estimate/:cardId', handler: getEstimate }
];
