import { idOf } from './db/query';
import { notify } from './notify';

/**
 * The other members of a collection, told when someone adds a wish to it: what a member
 * wants is what the others might give them. Only an add made by hand from the app counts,
 * never an import or a restore. A run of wishes from one member within the hour stays one
 * line, counting up, that leads to the wishlist.
 */
export function noticeWish(params: {
  collection: any;
  actor: { _id: any; username?: string };
  item: { _id?: any; title?: string; cover_image?: string };
  itemPath: string;
}): Promise<void> {
  const collection = params.collection;
  const members = (collection?.members || []).map((m: any) => idOf(m.user));
  const actorId = idOf(params.actor._id);
  return notify({
    event: 'wishlist.added',
    to: members,
    actor: actorId,
    collection: collection?._id,
    payload: { actor: params.actor.username || '', item: params.item.title || '', cover: params.item.cover_image || '' },
    link: params.item._id ? `${params.itemPath}/${idOf(params.item._id)}` : '/wishlist',
    group: `wishlist-${idOf(collection?._id)}-${actorId}`,
    groupLink: '/wishlist'
  });
}
