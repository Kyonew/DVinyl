import { PluginApiRoute } from '../../core/types';
import { db } from '../../core/db';
import { and, eq, filled, idOf } from '../../core/db/query';
import { fetchOnePieceCard } from './optcgapi';

async function getCollectionIds(req: any, res: any) {
  try {
    // A card added by hand has no optcgapi.com id to price, so it is left out of the run.
    const items = await db.items.find(and(
      eq('collection', idOf(res.locals.activeCollectionId)),
      eq('in_wishlist', false),
      eq('kind', 'OnePiece'),
      filled('op_card_id')
    ), { fields: ['op_card_id', 'quantity'] });
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
