/**
 * Invite links: a collection admin hands out a link, and whoever opens it creates their
 * own account (or brings the one they already have) and lands in the collection with the
 * role the link carries. Each link works once and stops working at its expiry.
 *
 * Stored on the collection (Collection.inviteLinks), like share links.
 */

import crypto from 'crypto';
import { db } from './db';
import { and, eq, Filter, some } from './db/query';

export const INVITE_ROLES = ['viewer', 'editor', 'admin'] as const;
export type InviteRole = typeof INVITE_ROLES[number];

/** How long a new link stays valid, in days, as the admin can choose it. */
export const INVITE_VALIDITY_DAYS = [1, 7, 30] as const;
export const DEFAULT_INVITE_VALIDITY_DAYS = 7;

export interface InviteLink {
  token: string;
  role: InviteRole;
  expiresAt: Date;
  createdBy?: any;
  createdAt?: Date;
}

export function inviteRole(value: unknown): InviteRole {
  return (INVITE_ROLES as readonly string[]).includes(String(value)) ? (value as InviteRole) : 'viewer';
}

export function inviteValidityDays(value: unknown): number {
  const days = Number(value);
  return (INVITE_VALIDITY_DAYS as readonly number[]).includes(days) ? days : DEFAULT_INVITE_VALIDITY_DAYS;
}

export function isInviteLive(link: { expiresAt?: any } | null | undefined, now = new Date()): boolean {
  if (!link?.expiresAt) return false;
  return new Date(link.expiresAt).getTime() > now.getTime();
}

/** The links of a collection that still work, soonest to expire first. */
export function liveInvites(collection: any, now = new Date()): InviteLink[] {
  return (collection?.inviteLinks || [])
    .filter((l: any) => isInviteLive(l, now))
    .sort((a: any, b: any) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
}

/** A new link for `collectionFilter`, with expired ones cleared out on the way. */
export async function createInvite(
  collectionFilter: Filter,
  options: { role: unknown; days: unknown; createdBy: any },
): Promise<InviteLink> {
  const now = new Date();
  const link: InviteLink = {
    token: crypto.randomBytes(24).toString('hex'),
    role: inviteRole(options.role),
    expiresAt: new Date(now.getTime() + inviteValidityDays(options.days) * 24 * 60 * 60 * 1000),
    createdBy: options.createdBy ?? null,
    createdAt: now,
  };
  const current: any = await db.collections.findOne(collectionFilter, { fields: ['inviteLinks'] });
  const kept = liveInvites(current, now);
  await db.collections.updateOne(collectionFilter, { set: { inviteLinks: [...kept, link] } });
  return link;
}

/**
 * The collection a still valid link opens, with the link itself, or null. An unknown, used
 * or expired token all come back null, so a page never says which of them it was.
 */
export async function findInvite(token: unknown): Promise<{ collection: any; invite: InviteLink } | null> {
  const value = String(token || '');
  if (!/^[0-9a-f]{48}$/.test(value)) return null;
  const collection: any = await db.collections.findOne(some('inviteLinks', eq('token', value)));
  const invite = (collection?.inviteLinks || []).find((l: any) => l.token === value);
  if (!collection || !isInviteLive(invite)) return null;
  return { collection, invite };
}

/**
 * Uses up a link. False when it was already gone, which is how two people opening the same
 * link at once do not both get in.
 */
export async function consumeInvite(collectionId: any, token: string): Promise<boolean> {
  const result = await db.collections.updateOne(
    and(eq('_id', collectionId), eq('inviteLinks.token', token)),
    { pull: { inviteLinks: eq('token', token) } },
  );
  return result.matched > 0;
}

export async function deleteInvite(collectionFilter: Filter, token: string): Promise<boolean> {
  const result = await db.collections.updateOne(
    and(collectionFilter, eq('inviteLinks.token', token)),
    { pull: { inviteLinks: eq('token', token) } },
  );
  return result.matched > 0;
}
