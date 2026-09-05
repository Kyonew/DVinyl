import Furniture from '../models/Furniture';
import Item from '../models/Item';
import { resolveShelfItems } from '../utils/itemHelpers';
import { registry } from './registry';
import { measureSpines, tallestFormat, SPINE_MAX_HEIGHT_PX } from './spine';
import { CollectionView } from './types';

// A reserve holding a whole collection is a wall of spines nobody can read, and a page
// nobody can load. Draw a screenful of it and say how much more there is.
const UNSORTED_LIMIT = 200;

/**
 * The collection drawn as furniture: items standing on their spine in the compartment
 * their `location` names, and a reserve underneath for everything standing nowhere.
 *
 * Read-only. Building the furniture and putting things away come later; what this does
 * is show what the collection already says about where its items are kept.
 */
export const SHELF_VIEW: CollectionView = {
  id: 'shelf',
  label: 'collection.view_shelf',
  icon: 'fa-table-columns',
  order: 20,
  partial: 'partials/shelf-view',
  paginates: 'none',

  isAvailable: async (context) => {
    // A wishlist is a list of things nobody owns yet, so none of it is anywhere.
    if (context.inWishlist) return false;

    // Where things are kept is not part of what a share link shows (see
    // SHARE_HIDDEN_FIELDS), and a shelf is nothing but that. A visitor keeps the grid
    // until the view learns to respect a link's scope.
    if (context.res.locals.isShareView) return false;

    const collectionId = context.res.locals.activeCollectionId;
    if (!collectionId) return false;
    if ((await Furniture.countDocuments({ collection: collectionId })) > 0) return true;

    // Nothing to stand anything on yet. Whoever is allowed to build the furniture still
    // needs the view that builds it, or deleting the last piece would be a one-way door
    // out of the shelf entirely.
    return context.res.locals.canEditCollection === true;
  },

  buildData: async (context, base) => {
    const { req, res, itemQuery, itemSort } = context;
    const collectionId = res.locals.activeCollectionId;

    const furnitureList = await Furniture.find({ collection: collectionId })
      .sort({ order: 1, created_at: 1 })
      .lean();

    // Moving from one piece of furniture to the next is paging, so it keeps the filters
    // and the search the page is under, exactly as the item pager does.
    for (const piece of furnitureList) {
      const params = new URLSearchParams(req.query as any);
      params.delete('page');
      params.set('view', 'shelf');
      params.set('furniture', String(piece._id));
      (piece as any).href = '?' + params.toString();
    }

    const requestedId = String(req.query.furniture || '');
    const activeFurniture = furnitureList.find(f => String(f._id) === requestedId) || furnitureList[0];
    if (!activeFurniture) {
      return { furnitureList, activeFurniture: null, shelfRows: [], shelfColumns: 1, unsorted: [], unsortedTotal: 0, unsortedShown: 0 };
    }

    const cells: any[] = activeFurniture.cells || [];

    // Every shelf name in the collection, not only this furniture's: something standing
    // in the next piece of furniture is not unsorted, it is just not on this page.
    const shelvedNames = furnitureList.flatMap((f: any) => (f.cells || []).map((c: any) => c.name));

    // Exact names, deliberately not the case-insensitive substring the location filter
    // uses (see the LOCATION FILTER in core/routes/collectionRoute.ts): a compartment
    // called "Salon" must not draw the contents of "Étagère du salon".
    //
    // The reserve is the complement of that same list rather than "no location at all",
    // which also catches a value that names no shelf, e.g. one typed straight into the
    // database or restored from an older backup. $nin matches a missing field too.
    const [shelved, unsortedRaw, unsortedTotal] = await Promise.all([
      Item.find({ ...itemQuery, location: { $in: cells.map(c => c.name) } }).sort(itemSort).lean(),
      Item.find({ ...itemQuery, location: { $nin: shelvedNames } }).sort(itemSort).limit(UNSORTED_LIMIT).lean(),
      Item.countDocuments({ ...itemQuery, location: { $nin: shelvedNames } })
    ]);

    // Which compartment an item stands in is the holder's business: a show shelved in
    // the living room stays there even when the page draws its only season instead of
    // it, and the season carries no location of its own.
    const shelfLocations = shelved.map((item: any) => item.location);

    const decorate = async (items: any[]) => {
      const resolved = await resolveShelfItems(items, res);
      return resolved.map((item: any) => {
        const plugin = registry.getByKind(item.kind as any);
        return plugin ? plugin.formatForView(item) : item;
      });
    };

    const [shelvedView, unsorted] = await Promise.all([decorate(shelved), decorate(unsortedRaw)]);
    shelvedView.forEach((item: any, index: number) => { item.shelfLocation = shelfLocations[index]; });

    // One scale for the whole piece of furniture, read from what the collection's own
    // types can hold rather than from what survived the filters, so the shelf keeps its
    // shape whatever is being looked at.
    const reference = tallestFormat(registry.getEnabled(res.locals.settings));
    measureSpines([...shelvedView, ...unsorted], (item: any) => registry.getByKind(item.kind as any), reference);

    const byLocation = new Map<string, any[]>();
    for (const item of shelvedView) {
      byLocation.set(item.shelfLocation, [...(byLocation.get(item.shelfLocation) || []), item]);
    }

    // The declared grid, widened if a cell sits outside it. Costs nothing when the two
    // agree, and means a compartment can never become invisible through a bad row or
    // column number.
    const rowCount = Math.max(activeFurniture.rows || 1, ...cells.map(c => c.row + 1));
    const columnCount = Math.max(activeFurniture.columns || 1, ...cells.map(c => c.column + 1));

    const shelfRows = [];
    for (let row = 0; row < rowCount; row++) {
      const slots = [];
      for (let column = 0; column < columnCount; column++) {
        const cell = cells.find(c => c.row === row && c.column === column);
        slots.push(cell ? {
          name: cell.name,
          capacity: cell.capacity || 0,
          items: byLocation.get(cell.name) || []
        } : null);
      }
      shelfRows.push(slots);
    }

    return {
      furnitureList,
      activeFurniture,
      // The same compartments, flat and in reading order, which is the shape the editor
      // works in: it reorders a list and lets the column count decide the grid.
      shelfCells: cells
        .slice()
        .sort((a, b) => (a.row - b.row) || (a.column - b.column))
        .map(cell => ({
          key: cell.key,
          name: cell.name,
          capacity: cell.capacity || 0,
          count: (byLocation.get(cell.name) || []).length
        })),
      shelfRows,
      shelfColumns: columnCount,
      shelfMaxSpineHeight: SPINE_MAX_HEIGHT_PX,
      unsorted,
      unsortedTotal,
      unsortedShown: unsorted.length
    };
  }
};
