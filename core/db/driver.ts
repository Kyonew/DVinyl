/**
 * Which store the app runs on, chosen once at boot.
 *
 * SQLite is the store from 4.0 on. An install upgraded from 3.x still names its MongoDB
 * server in MONGODB_URL, and its configuration (a 3.x compose file, an Unraid container)
 * often mounts no data folder for the SQLite file. Refusing to start there would stop
 * every such install on its first automatic update, so it keeps running on MongoDB as
 * before, and moves to SQLite on its own the first time it starts with a data folder
 * mounted (see core/db/importFromMongo.ts and docs/docker.md "Moving to SQLite").
 *
 * DB_DRIVER, when set, is obeyed as is: sqlite then insists on a mounted data folder.
 */

export type Driver = 'sqlite' | 'mongodb';

/** Why that store: asked for, the default, or kept on MongoDB for want of a data folder. */
export type DriverReason = 'chosen' | 'default' | 'fallback';

export interface DriverEnv {
  DB_DRIVER?: string | undefined;
  MONGODB_URL?: string | undefined;
  EPHEMERAL_DATA?: string | undefined;
}

export function chooseDriver(env: DriverEnv, sqliteWouldPersist: () => boolean): { driver: Driver; reason: DriverReason } {
  if (env.DB_DRIVER === 'mongodb') return { driver: 'mongodb', reason: 'chosen' };
  if (env.DB_DRIVER === 'sqlite') return { driver: 'sqlite', reason: 'chosen' };
  if (!env.MONGODB_URL || env.EPHEMERAL_DATA === 'true') return { driver: 'sqlite', reason: 'default' };
  return sqliteWouldPersist() ? { driver: 'sqlite', reason: 'default' } : { driver: 'mongodb', reason: 'fallback' };
}
