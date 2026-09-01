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
    const userCurrency = res.locals.user.currency || 'USD';

    // views/collection.ejs sums `price.value` and labels the total with the user's own
    // currency, ignoring the `currency` we return — and Scryfall's price fields are
    // fixed-currency, not selectable. So try the currency the user actually uses first;
    // the foil/non-foil sub-ordering is preserved within whichever currency wins.
    // `tix` is deliberately absent: MTGO event tickets aren't a currency the app's
    // currency selector supports, so surfacing one mislabeled as the user's currency
    // would be actively wrong rather than merely imprecise.
    const usdChain: Array<[keyof typeof prices, string]> = isFoil
      ? [['usd_foil', 'USD'], ['usd', 'USD']]
      : [['usd', 'USD'], ['usd_foil', 'USD']];
    const eurChain: Array<[keyof typeof prices, string]> = [['eur', 'EUR']];

    const chain: Array<[keyof typeof prices, string]> = userCurrency === 'EUR'
      ? [...eurChain, ...usdChain]
      : [...usdChain, ...eurChain];

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
