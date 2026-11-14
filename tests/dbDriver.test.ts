import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseDriver } from '../core/db/driver';
import { movedAwayMessage, unmountedMessage } from '../config/dataVolume';
import { alreadyMovedMessage } from '../core/db/importFromMongo';

const mounted = () => true;
const notMounted = () => false;
const URL = 'mongodb://mongodb:27017/dvinyl';

test('a new install runs on SQLite, mounted or not (the data folder check then speaks)', () => {
  assert.deepEqual(chooseDriver({}, mounted), { driver: 'sqlite', reason: 'default' });
  assert.deepEqual(chooseDriver({}, notMounted), { driver: 'sqlite', reason: 'default' });
});

test('a 3.x install with its data folder mounted moves to SQLite', () => {
  assert.deepEqual(chooseDriver({ MONGODB_URL: URL }, mounted), { driver: 'sqlite', reason: 'default' });
});

test('a 3.x install with no data folder keeps running on MongoDB instead of stopping', () => {
  assert.deepEqual(chooseDriver({ MONGODB_URL: URL }, notMounted), { driver: 'mongodb', reason: 'fallback' });
});

test('DB_DRIVER is obeyed whatever is mounted, and a throwaway store never falls back', () => {
  assert.deepEqual(chooseDriver({ MONGODB_URL: URL, DB_DRIVER: 'sqlite' }, notMounted), { driver: 'sqlite', reason: 'chosen' });
  assert.deepEqual(chooseDriver({ MONGODB_URL: URL, DB_DRIVER: 'mongodb' }, mounted), { driver: 'mongodb', reason: 'chosen' });
  assert.deepEqual(chooseDriver({ MONGODB_URL: URL, EPHEMERAL_DATA: 'true' }, notMounted), { driver: 'sqlite', reason: 'default' });
});

test('the data folder check is only asked when it decides something', () => {
  let asked = 0;
  const count = () => { asked += 1; return false; };
  chooseDriver({}, count);
  chooseDriver({ MONGODB_URL: URL, DB_DRIVER: 'sqlite' }, count);
  assert.equal(asked, 0);
});

test('the messages name the folder, the date and the way out', () => {
  const at = new Date('2026-11-20T10:00:00Z');
  assert.match(movedAwayMessage(at, '/app/data'), /2026-11-20.*\/app\/data/);
  assert.match(alreadyMovedMessage(at), /MONGODB_REIMPORT=true/);
  assert.match(unmountedMessage('/app/data'), /keeps running on MongoDB/);
});
