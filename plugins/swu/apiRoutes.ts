import { PluginApiRoute } from '../../core/types';
import Item from '../../models/Item';
import { fetchSwuCard } from './swudb';

async function getCollectionIds(req: any, res: any) {
  try {
    const items = await Item.find({
      collection: res.locals.activeCollectionId,
      in_wishlist: false,
      kind: 'Swu'
    }).select('swu_card_id quantity').lean();
    res.json({ success: true, albums: items });
  } catch (err: any) {
    console.error('API SWU Collection IDs error:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
}

// Flat model, same shape as One Piece's estimate route: MarketPrice, falling back to
// FoilPrice then LowPrice — SWU's card_condition is a wear scale, not a foil flag, so
// (unlike MTG) there's no reliable per-item signal to pick a specific price column.
async function getEstimate(req: any, res: any) {
  try {
    const card = await fetchSwuCard(req.params.cardId);
    const value = parseFloat(card.MarketPrice || '0') || parseFloat(card.FoilPrice || '0') || parseFloat(card.LowPrice || '0') || 0;
    if (value > 0) {
      return res.json({ success: true, source: 'swu-db', price: { value, currency: 'USD' }, details: 'market' });
    }
    res.json({ success: false, error: 'Unavailable' });
  } catch (err: any) {
    console.error('SWU estimation server error:', err.message);
    res.json({ success: false, error: 'Server error' });
  }
}

export const swuApiRoutes: PluginApiRoute[] = [
  { method: 'get', path: '/api/swu/collection/ids', handler: getCollectionIds },
  { method: 'get', path: '/api/swu/estimate/:cardId', handler: getEstimate }
];
