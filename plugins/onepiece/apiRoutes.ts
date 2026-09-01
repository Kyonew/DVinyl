import { PluginApiRoute } from '../../core/types';
import Item from '../../models/Item';
import { fetchOnePieceCard } from './optcgapi';

async function getCollectionIds(req: any, res: any) {
  try {
    const items = await Item.find({
      collection: res.locals.activeCollectionId,
      in_wishlist: false,
      kind: 'OnePiece'
    }).select('op_card_id quantity').lean();
    res.json({ success: true, albums: items });
  } catch (err: any) {
    console.error('API One Piece Collection IDs error:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
}

// The simplest estimate route of the four: market_price/inventory_price are flat,
// already-in-USD numbers directly on the card, no per-variant/provider nesting.
async function getEstimate(req: any, res: any) {
  try {
    const card = await fetchOnePieceCard(req.params.cardId);
    const value = card.market_price || card.inventory_price || 0;
    if (value > 0) {
      return res.json({
        success: true,
        source: 'optcgapi',
        price: { value, currency: 'USD' },
        details: card.market_price ? 'market' : 'inventory'
      });
    }
    res.json({ success: false, error: 'Unavailable' });
  } catch (err: any) {
    console.error('One Piece estimation server error:', err.message);
    res.json({ success: false, error: 'Server error' });
  }
}

export const onePieceApiRoutes: PluginApiRoute[] = [
  { method: 'get', path: '/api/onepiece/collection/ids', handler: getCollectionIds },
  { method: 'get', path: '/api/onepiece/estimate/:cardId', handler: getEstimate }
];
