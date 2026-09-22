import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import User from '../../models/User';
import Collection from '../../models/Collection';
import Settings from '../../models/Settings';
import LoginLog from '../../models/LoginLog';
import { registry } from '../../core/registry';

let seq = 0;
const uniq = (): string => `${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

export async function makeUser(opts: {
  username?: string;
  email?: string;
  password?: string | null;
  isAdmin?: boolean;
  oidc?: { sub: string; linkedAt?: Date; autoProvisioned?: boolean };
  img?: string;
} = {}): Promise<{ user: any; password: string | null }> {
  const username = opts.username ?? `user-${uniq()}`;
  const email = opts.email ?? `${username}@example.com`;
  const password = opts.password === undefined ? 'password123' : opts.password;

  const doc: Record<string, any> = {
    username,
    email,
    isAdmin: !!opts.isAdmin,
    lastChange: new Date(0)
  };
  if (password !== null) doc.password = await bcrypt.hash(password, 10);
  if (opts.oidc) doc.oidc = opts.oidc;
  if (opts.img) doc.img = opts.img;

  const user = await User.create(doc);
  return { user, password };
}

export async function makeCollection(opts: {
  name?: string;
  members: { user: any; role: 'admin' | 'editor' | 'viewer' }[];
  isDefault?: boolean;
}): Promise<any> {
  const first = opts.members[0];
  if (!first) throw new Error('makeCollection needs at least one member');
  return Collection.create({
    name: opts.name ?? `Collection ${uniq()}`,
    slug: `test-${uniq()}`,
    createdBy: first.user._id,
    isDefault: !!opts.isDefault,
    members: opts.members.map(m => ({ user: m.user._id, role: m.role }))
  });
}

/** Every registered plugin's module turned on, so listings/stats see seeded items. */
export function allModulesOn(): Record<string, boolean> {
  const modules: Record<string, boolean> = {};
  for (const plugin of registry.getAll()) modules[plugin.collectionType] = true;
  return modules;
}

export async function makeSettings(collection: any, overrides: Record<string, any> = {}): Promise<any> {
  // Upsert, so a second call for the same collection updates rather than hitting
  // the unique `collection` index (a collection has exactly one Settings row).
  return Settings.findOneAndUpdate(
    { collection: collection._id },
    { $set: { modules: allModulesOn(), ...overrides } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export function itemModel(kind: string): mongoose.Model<any> {
  return mongoose.model(kind);
}

export async function makeItem(kind: string, data: Record<string, any>): Promise<any> {
  return itemModel(kind).create(data);
}

export async function makeLoginLog(data: Record<string, any> = {}): Promise<any> {
  return LoginLog.create({
    username: data.username ?? `user-${uniq()}`,
    email: data.email ?? `${uniq()}@example.com`,
    ip: data.ip ?? '127.0.0.1',
    status: data.status ?? 'success',
    timestamp: data.timestamp ?? new Date(),
    ...data
  });
}
