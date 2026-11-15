import assert from 'node:assert/strict';
import test from 'node:test';
import { isPersisted, parseMountInfo, unmountedMessage } from '../config/dataVolume';

// Trimmed from a real container: the overlay root, the usual files Docker mounts, and
// whatever the test adds below.
const BASE = [
  '1101 900 0:120 / / rw,relatime master:500 - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/A',
  '1102 1101 0:123 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw',
  '1103 1101 0:124 / /dev rw,nosuid - tmpfs tmpfs rw,size=65536k,mode=755',
  '1110 1101 259:2 /var/lib/docker/containers/abc/resolv.conf /etc/resolv.conf rw,relatime - ext4 /dev/nvme0n1p2 rw',
  '1111 1101 259:2 /var/lib/docker/containers/abc/hosts /etc/hosts rw,relatime - ext4 /dev/nvme0n1p2 rw',
  '1112 1101 259:2 /home/me/dvinyl/public/uploads /app/public/uploads rw,relatime - ext4 /dev/nvme0n1p2 rw'
];
const mounts = (...extra: string[]) => parseMountInfo([...BASE, ...extra].join('\n'));

test('a 3.x compose, which mounts only the uploads, leaves the data folder unpersisted', () => {
  assert.equal(isPersisted('/app/data', mounts()), false);
});

test('a bind mount or a named volume on the data folder persists it', () => {
  assert.equal(isPersisted('/app/data', mounts('1113 1101 259:2 /home/me/dvinyl/data /app/data rw - ext4 /dev/nvme0n1p2 rw')), true);
  assert.equal(isPersisted('/app/data', mounts('1113 1101 259:2 /var/lib/docker/volumes/dvinyl_data/_data /app/data rw - ext4 /dev/nvme0n1p2 rw')), true);
});

test('a mount on a parent of the data folder persists it, a sibling with a similar name does not', () => {
  assert.equal(isPersisted('/srv/dvinyl/data', mounts('1113 1101 259:2 /x /srv rw - ext4 /dev/sda1 rw')), true);
  assert.equal(isPersisted('/app/data', mounts('1113 1101 259:2 /x /app/dat rw - ext4 /dev/sda1 rw')), false);
});

test('a tmpfs on the data folder is gone on restart, so it does not count', () => {
  assert.equal(isPersisted('/app/data', mounts('1113 1101 0:130 / /app/data rw - tmpfs tmpfs rw')), false);
});

test('mount points with escaped spaces are read back as written', () => {
  assert.equal(isPersisted('/app/my data', mounts('1113 1101 259:2 /x /app/my\\040data rw - ext4 /dev/sda1 rw')), true);
});

test('the message tells what to mount, where, and how to opt out', () => {
  const message = unmountedMessage('/app/data');
  assert.match(message, /Please mount DVinyl's data folder \(\/app\/data\)/);
  assert.match(message, /- \.\/data:\/app\/data/);
  assert.match(message, /EPHEMERAL_DATA=true/);
});
