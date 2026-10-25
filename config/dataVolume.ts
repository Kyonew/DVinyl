/**
 * Refuses to start a container whose data folder is not mounted from the host.
 *
 * Inside a container, a folder nothing is mounted on lives in the container's own layer,
 * which is dropped whenever the container is recreated: every update, every "Apply" on
 * Unraid. DVinyl would run fine until then, and the next update would silently start it
 * again on an empty store, or on a fresh import of the 3.x data, losing everything written
 * in between. Stopping at once, before anything is written, turns that into a message.
 */

import fs from 'fs';
import path from 'path';
import { StartupError } from './startupError';

const UPGRADE_GUIDE = 'https://github.com/Kyonew/DVinyl/blob/main/docs/docker.md#-upgrading-from-3x-to-40';

/** Docker and Podman both leave a marker file at the root of their containers. */
export function inContainer(): boolean {
  return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
}

/** The mount points /proc/self/mountinfo lists, with their filesystem type. */
export function parseMountInfo(text: string): { point: string; type: string }[] {
  const unescape = (value: string) => value.replace(/\\([0-7]{3})/g, (_, code) => String.fromCharCode(parseInt(code, 8)));
  return text.split('\n').filter(Boolean).map(line => {
    const [before = '', after = ''] = line.split(' - ');
    return { point: unescape(before.split(' ')[4] || ''), type: after.split(' ')[0] || '' };
  });
}

/**
 * Whether `dir` sits on something mounted into the container: the folder itself or one of
 * its parents, but not the container's root, and not a tmpfs, which is gone on restart.
 */
export function isPersisted(dir: string, mounts: { point: string; type: string }[]): boolean {
  return mounts.some(({ point, type }) =>
    point !== '/' && type !== 'tmpfs' && (dir === point || dir.startsWith(point.endsWith('/') ? point : point + '/'))
  );
}

/** The message a container started without its data folder mounted stops with. */
export function unmountedMessage(dir: string): string {
  return [
    `[DATA] Please mount DVinyl's data folder (${dir}) from the host, then start the container again.`,
    '',
    'DVinyl keeps your whole collection in that folder. It is not mounted, so everything written',
    'there would be lost the next time the container is recreated (an update, an "Apply" on',
    'Unraid). DVinyl stopped before writing anything.',
    '',
    'How to mount it:',
    `  - Docker Compose: under "volumes:" of the DVinyl service, add  - ./data:${dir}`,
    `  - docker run: add  -v /a/folder/on/the/host:${dir}`,
    `  - Unraid: edit the container and add a Path whose Container Path is ${dir}`,
    '',
    'Upgrading from 3.x? Leave MONGODB_URL and your MongoDB container as they are: your data is',
    `imported on the first start once the folder is mounted. Guide: ${UPGRADE_GUIDE}`,
    '',
    'To run on purpose with data that is thrown away (a demo), set EPHEMERAL_DATA=true.'
  ].join('\n');
}

/** Throws when the SQLite file `file` would be lost with the container. */
export function assertDataPersisted(file: string): void {
  if (file === ':memory:' || process.env.EPHEMERAL_DATA === 'true' || !inContainer()) return;
  let mountInfo: string;
  try {
    mountInfo = fs.readFileSync('/proc/self/mountinfo', 'utf8');
  } catch {
    return; // Nothing tells what is mounted: do not stand in the way.
  }
  const dir = path.dirname(path.resolve(file));
  if (!isPersisted(dir, parseMountInfo(mountInfo))) throw new StartupError(unmountedMessage(dir));
}
