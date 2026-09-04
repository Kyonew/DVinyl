import { CollectionView, CollectionViewContext } from './types';
import { SHELF_VIEW } from './shelfView';

// The view a page starts on before anybody chooses, and the one it falls back to.
export const DEFAULT_VIEW_ID = 'grid';

// Built-in views. Declared here rather than discovered on disk like the plugins:
// a view is part of the core UI, not something an installation drops in.
const GRID_VIEW: CollectionView = {
  id: DEFAULT_VIEW_ID,
  label: 'collection.view_grid',
  icon: 'fa-table-cells',
  order: 10,
  partial: 'partials/albums-grid',
  paginates: 'items'
};

/**
 * The views the collection and the wishlist can be drawn in.
 *
 * Same idea as the plugin registry: the pages hold no knowledge of any particular
 * view. They render the active view's partial, and the selector lists whatever is
 * registered here, so adding a way to look at a collection is a declaration plus a
 * partial rather than a condition threaded through collection.ejs.
 */
class ViewRegistry {
  private views: Map<string, CollectionView> = new Map();

  register(view: CollectionView): void {
    this.views.set(view.id, view);
  }

  get(id: string): CollectionView | undefined {
    return this.views.get(id);
  }

  getAll(): CollectionView[] {
    return Array.from(this.views.values())
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  /** The views offered on this particular page, in selector order. */
  async getAvailable(context: CollectionViewContext): Promise<CollectionView[]> {
    const verdicts = await Promise.all(
      this.getAll().map(view => view.isAvailable ? view.isAvailable(context) : true)
    );
    return this.getAll().filter((_, index) => verdicts[index]);
  }

  /**
   * The view to render for a requested id, which reaches us from a query string or a
   * cookie and is therefore arbitrary text. An id that is unknown, or known but not
   * available on this page, falls back to the default rather than failing: a view can
   * stop being available between the moment it was chosen and the next page load.
   *
   * Takes the available list rather than the context so the page resolves it once and
   * hands the same list to the view selector, instead of asking every view twice.
   *
   * The page always has something to draw, down to the grid itself: it is the floor
   * the core falls back to when every view has opted out of this page.
   */
  resolve(requested: unknown, available: CollectionView[]): CollectionView {
    const chosen = (typeof requested === 'string'
      ? available.find(view => view.id === requested)
      : undefined)
      || available.find(view => view.id === DEFAULT_VIEW_ID)
      || available[0];
    return chosen || GRID_VIEW;
  }
}

export const viewRegistry = new ViewRegistry();

viewRegistry.register(GRID_VIEW);
viewRegistry.register(SHELF_VIEW);

