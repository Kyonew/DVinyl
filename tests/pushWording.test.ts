import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import i18next from 'i18next';
import { pushWording } from '../core/notify';

describe('push wording', () => {
  let fr: any;
  let en: any;
  before(async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ resources: { fr: { translation: require('../locales/fr.json') }, en: { translation: require('../locales/en.json') } }, lng: 'fr' });
    fr = i18n.getFixedT('fr');
    en = i18n.getFixedT('en');
  });

  it('reads like a message: who in the title, what and about which item below', () => {
    const row = { event: 'request.received', payload: { actor: "Kyo'", kind: 'Emprunter', item: 'Charizard ex', quote: 'Je te le rends vite !' } };
    assert.deepEqual(pushWording(row, fr, 'Vinyl'), { title: "Kyo'", body: '📩 Emprunter · Charizard ex\n"Je te le rends vite !"' });
    assert.equal(pushWording({ event: 'request.accepted', payload: { actor: 'Alex', kind: 'Borrow', item: 'Dune' } }, en).body, '✅ accepted · Borrow\nDune');
  });

  it('says the step reached, and the due date of a late one', () => {
    assert.equal(pushWording({ event: 'request.step', payload: { actor: 'Alex', kind: 'Emprunter', item: 'Dune', step: 'Rendu' } }, fr).body, '➡️ Rendu · Emprunter\nDune');
    const late = pushWording({ event: 'request.overdue', payload: { kind: 'Emprunter', item: 'Dune', due: '2026-10-20' } }, fr);
    assert.deepEqual(late, { title: 'Dune', body: '⏰ En retard depuis le 20 octobre · Emprunter' });
  });

  it('cuts a long quote, and falls back on the collection with nobody and nothing named', () => {
    const long = 'a'.repeat(400);
    const { body } = pushWording({ event: 'request.declined', payload: { actor: 'Alex', quote: long } }, fr, 'Vinyl');
    assert.equal(pushWording({ event: 'request.overdue', payload: {} }, fr, 'Vinyl').title, 'Vinyl');
    assert.ok(body.length < 200);
    assert.ok(body.endsWith('…"'));
  });

  it('names a sign-in\'s country in the reader\'s language, and titles what nobody did', () => {
    const row = { event: 'account.new_login', payload: { device: 'Safari · iOS', country: 'DE', city: 'Berlin', ip: '1.2.3.4' } };
    assert.deepEqual(pushWording(row, fr), { title: 'Nouvelle connexion', body: "🔐 Safari · iOS · Berlin, Allemagne\nCe n'est pas vous ? Changez votre mot de passe." });
    assert.match(pushWording(row, en).body, /Berlin, Germany/);
    assert.match(pushWording({ event: 'account.new_login', payload: { device: 'Chrome', country: 'XX', city: '' } }, en).body, /Chrome · Unknown/);
    assert.equal(pushWording({ event: 'instance.update_available', payload: { version: '4.1.0', current: '4.0.0' } }, en).title, 'DVinyl 4.1.0');
  });

  it('counts what a grouped line stands for', () => {
    assert.equal(pushWording({ event: 'wishlist.added', payload: { actor: 'Alex', item: 'Dune', count: 1 } }, en).body, '⭐ added to the wishlist\nDune');
    assert.equal(pushWording({ event: 'wishlist.added', payload: { actor: 'Alex', item: 'Dune', count: 3 } }, en).body, '⭐ added 3 items to the wishlist\nLatest: Dune');
  });
});
