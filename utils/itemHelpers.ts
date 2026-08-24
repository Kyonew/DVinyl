import Item from '../models/Item';
import { registry } from '../core/registry';
import { applyVisibilityFilter } from './visibilityHelper';

/**
 * Resolves, for a page of items, what each one should actually show on the shelf.
 *
 * A holder with several contents keeps its own identity and gains a line saying what it
 * holds ("Seasons 1 to 4"). A holder with exactly one takes its place entirely: what is
 * owned is that season's box, with that season's artwork, and standing in front of it with
 * the show's generic poster would misdescribe the shelf. The holder stays in the data and
 * reappears on its own the day a second season arrives, which is why this is a display
 * rule and not a second way of storing things.
 *
 * What the collection hides from its viewers never comes back this way: a hidden item is
 * out of the listing, and standing in for its holder would put it right back on the shelf.
 * The line saying what is owned counts the same set, so it never mentions what it hides.
 *
 * Mutates nothing: returns the array to render. Costs one query for the whole page.
 */
export async function resolveShelfItems(items: any[], res: any): Promise<any[]> {
    if (!items || items.length === 0) return items || [];

    const query: any = { parent: { $in: items.map(i => i._id) } };
    applyVisibilityFilter(query, res.locals.isCollectionAdmin, res.locals.settings);

    const contained = await Item.find(query).lean();
    if (contained.length === 0) return items;

    const byHolder = new Map<string, any[]>();
    for (const child of contained) {
        const key = String(child.parent);
        byHolder.set(key, [...(byHolder.get(key) || []), child]);
    }

    return items.map(item => {
        const children = byHolder.get(String(item._id));
        if (!children || children.length === 0) return item;
        if (children.length === 1) return children[0];

        const plugin = registry.getByKind(item.kind as any);
        return { ...item, containsLabel: plugin?.cardContains ? plugin.cardContains(item, children) : null };
    });
}

/**
 * Moves whatever an item contains along with it, between the collection and the wishlist.
 *
 * A show and its seasons are one thing to own: receiving the show and leaving its seasons
 * behind would keep them wanted forever, and unreachably so, since a contained item is
 * absent from the wishlist like it is from every other listing. Only the holder is
 * re-dated, because that is what the two lists sort on; a season keeps the day it was
 * actually added.
 */
export async function moveContentsToWishlist(holderId: any, inWishlist: boolean, stamp: Record<string, any>): Promise<void> {
    await Item.updateMany({ parent: holderId }, { in_wishlist: inWishlist, ...stamp });
}

/**
 * Deletes items along with whatever they contain.
 *
 * A holder is a way in, not an object of its own: deleting a show and leaving its seasons
 * behind would strand them, since a contained item is deliberately absent from every
 * listing and could then never be reached again. One level deep is enough, a contained
 * item never holds others.
 *
 * Returns how many documents were actually removed, contents included.
 */
export async function deleteItemsAndContents(ids: any[]): Promise<number> {
    if (!ids || ids.length === 0) return 0;

    const contained = await Item.find({ parent: { $in: ids } }).select('_id').lean();
    const all = [...ids, ...contained.map((c: any) => c._id)];

    const result = await Item.deleteMany({ _id: { $in: all } });
    return result.deletedCount || 0;
}

/**
 * How many items a listing would delete, contents included, so a confirmation can say so
 * before anything is removed.
 */
export async function countItemsAndContents(ids: any[]): Promise<number> {
    if (!ids || ids.length === 0) return 0;
    return ids.length + await Item.countDocuments({ parent: { $in: ids } });
}
