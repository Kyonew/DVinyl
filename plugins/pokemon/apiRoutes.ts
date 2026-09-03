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
    const userCurrency = res.locals.user.currency || 'USD';

    // TCGPlayer market price (USD), first variant/sub-key that has one.
    const tcgplayerPlan = () => {
      for (const variant of variants) {
        const tcgplayer = variant.pricing?.tcgplayer;
        if (!tcgplayer) continue;
        for (const key of Object.keys(tcgplayer)) {
          if (key === 'unit' || key === 'updated') continue;
          const marketPrice = tcgplayer[key]?.marketPrice;
          if (typeof marketPrice === 'number' && marketPrice > 0) {
            return {
              success: true,
              source: 'tcgplayer',
              price: { value: marketPrice, currency: 'USD' },
              details: `${variant.type} (${key})`
            };
          }
        }
      }
      return null;
    };

    // Cardmarket average (EUR), first variant that has one.
    const cardmarketPlan = () => {
      for (const variant of variants) {
        const cardmarket = variant.pricing?.cardmarket;
        if (cardmarket && typeof cardmarket.avg === 'number' && cardmarket.avg > 0) {
          return {
            success: true,
            source: 'cardmarket',
            price: { value: cardmarket.avg, currency: 'EUR' },
            details: `${variant.type} average`
          };
        }
      }
      return null;
    };

    // views/collection.ejs sums `price.value` and labels the total with the user's own
    // currency, ignoring the `currency` returned here — and neither TCGdex price source
    // lets us ask for a specific currency. Running the source that matches the user's
    // currency first at least reduces the mismatch for EUR users.
    const plans = userCurrency === 'EUR'
      ? [cardmarketPlan, tcgplayerPlan]
      : [tcgplayerPlan, cardmarketPlan];

    for (const plan of plans) {
      const result = plan();
      if (result) return res.json(result);
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
