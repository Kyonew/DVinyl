import { PluginApiRoute } from '../../core/types';
import Item from '../../models/Item';
import { fetchScryfallCard } from './scryfall';

async function getCollectionIds(req: any, res: any) {
  try {
    const items = await Item.find({
      collection: res.locals.activeCollectionId,
      in_wishlist: false,
      kind: 'Mtg'
    }).select('scryfall_id quantity').lean();
    res.json({ success: true, albums: items });
  } catch (err: any) {
    console.error('API MTG Collection IDs error:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
}

async function getEstimate(req: any, res: any) {
  try {
    const card = await fetchScryfallCard(req.params.cardId);
    const prices = card.prices || {};
    const isFoil = (req.query.condition as string || '').toLowerCase().includes('foil');

    const chain: Array<[keyof typeof prices, string]> = isFoil
      ? [['usd_foil', 'USD'], ['usd', 'USD'], ['eur', 'EUR'], ['tix', 'MTGO tix']]
      : [['usd', 'USD'], ['usd_foil', 'USD'], ['eur', 'EUR'], ['tix', 'MTGO tix']];

    for (const [key, currency] of chain) {
      const raw = prices[key];
      const value = raw ? parseFloat(raw) : 0;
      if (value > 0) {
        return res.json({ success: true, source: 'scryfall', price: { value, currency }, details: key });
      }
    }
    res.json({ success: false, error: 'Unavailable' });
  } catch (err: any) {
    console.error('MTG estimation server error:', err.message);
    res.json({ success: false, error: 'Server error' });
  }
}

export const mtgApiRoutes: PluginApiRoute[] = [
  { method: 'get', path: '/api/mtg/collection/ids', handler: getCollectionIds },
  { method: 'get', path: '/api/mtg/estimate/:cardId', handler: getEstimate }
];
