import { PluginApiRoute } from '../../core/types';
import Item from '../../models/Item';
import { fetchTcgdexCard } from './tcgdex';

// GET ALL COLLECTION POKÉMON CARD IDs (used for the global estimate button).
// Response key is literally `albums` for every plugin, not just music — the
// generic front-end estimate script (views/collection.ejs) reads `data.albums`
// unconditionally, regardless of media type.
async function getCollectionIds(req: any, res: any) {
  try {
    const items = await Item.find({
      collection: res.locals.activeCollectionId,
      in_wishlist: false,
      kind: 'Pokemon'
    }).select('pokemon_card_id quantity').lean();
    res.json({ success: true, albums: items });
  } catch (err: any) {
    console.error('API Pokemon Collection IDs error:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
}

// ESTIMATE ROUTE (TCGdex embedded pricing)
async function getEstimate(req: any, res: any) {
  try {
    const cardId = req.params.cardId;
    const card = await fetchTcgdexCard(cardId);
    const variants = card.variants_detailed || [];

    // PLAN A: TCGPlayer market price, first variant/sub-key that has one.
    for (const variant of variants) {
      const tcgplayer = variant.pricing?.tcgplayer;
      if (!tcgplayer) continue;
      for (const key of Object.keys(tcgplayer)) {
        if (key === 'unit' || key === 'updated') continue;
        const marketPrice = tcgplayer[key]?.marketPrice;
        if (typeof marketPrice === 'number' && marketPrice > 0) {
          return res.json({
            success: true,
            source: 'tcgplayer',
            price: { value: marketPrice, currency: 'USD' },
            details: `${variant.type} (${key})`
          });
        }
      }
    }

    // PLAN B: Cardmarket average, first variant that has one.
    for (const variant of variants) {
      const cardmarket = variant.pricing?.cardmarket;
      if (cardmarket && typeof cardmarket.avg === 'number' && cardmarket.avg > 0) {
        return res.json({
          success: true,
          source: 'cardmarket',
          price: { value: cardmarket.avg, currency: 'EUR' },
          details: `${variant.type} average`
        });
      }
    }

    res.json({ success: false, error: 'Unavailable' });
  } catch (err: any) {
    console.error('Pokemon estimation server error:', err.message);
    res.json({ success: false, error: 'Server error' });
  }
}

export const pokemonApiRoutes: PluginApiRoute[] = [
  { method: 'get', path: '/api/pokemon/collection/ids', handler: getCollectionIds },
  { method: 'get', path: '/api/pokemon/estimate/:cardId', handler: getEstimate }
];
