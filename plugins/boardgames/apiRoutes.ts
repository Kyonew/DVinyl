import { PluginApiRoute } from '../../core/types';
import { db } from '../../core/db';
import { and, eq, filled, idOf } from '../../core/db/query';
import { createMarketplace, estimateFromListings, isBggId } from './marketplace';

const marketplace = createMarketplace();

// The games the estimate can look up. One added by hand has no BGG id, and what an
// import or a form left in the field is not always one: the page puts the id in the
// address it calls as it is, so only a BGG id, trimmed, goes out.
async function pricedGames(res: any): Promise<any[]> {
  const items = await db.items.find(and(
    eq('collection', idOf(res.locals.activeCollectionId)),
    eq('in_wishlist', false),
    eq('kind', 'BoardGame'),
    filled('bgg_id')
  ), { fields: ['bgg_id', 'quantity', 'purchase_price', 'purchase_currency'] });
  return items
    .map(item => ({ ...item, bgg_id: String(item.bgg_id).trim() }))
    .filter(item => isBggId(item.bgg_id));
}

// GET ALL COLLECTION BGG IDs (used for the global estimate button).
// Response key is literally `albums` for every plugin, not just music - the
// generic front-end estimate script (views/collection.ejs) reads `data.albums`
// unconditionally, regardless of media type.
async function getCollectionIds(req: any, res: any) {
  try {
    res.json({ success: true, albums: await pricedGames(res) });
  } catch (err: any) {
    console.error('API Board games Collection IDs error:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
}

// ESTIMATE ROUTE (BoardGameGeek marketplace listings)
async function getEstimate(req: any, res: any) {
  try {
    const bggId = String(req.params.bggId);
    if (!isBggId(bggId)) return res.json({ success: false, error: 'Unavailable' });

    // The games of the collection, in the order the estimate walks through them (the
    // ids route above), so that one call to BGG covers the next ones too. Only those are
    // priced: listings are kept in memory, which ids made up by hand would fill up.
    const run = (await pricedGames(res)).map(item => item.bgg_id);
    if (!run.includes(bggId)) return res.json({ success: false, error: 'Unavailable' });
    const listings = await marketplace.listingsFor(bggId, run);

    const currency = res.locals.user.currency || 'USD';
    const estimate = estimateFromListings(listings, currency);
    if (!estimate) return res.json({ success: false, error: 'Unavailable' });

    res.json({
      success: true,
      source: 'market',
      price: { value: estimate.value, currency },
      details: `${estimate.count} ${req.t('detail.for_sale')}`
    });
  } catch (err: any) {
    console.error('Board games estimation server error:', err.message);
    res.json({ success: false, error: 'Server error' });
  }
}

export const boardGamesApiRoutes: PluginApiRoute[] = [
  { method: 'get', path: '/api/boardgames/collection/ids', handler: getCollectionIds },
  { method: 'get', path: '/api/boardgames/estimate/:bggId', handler: getEstimate }
];
