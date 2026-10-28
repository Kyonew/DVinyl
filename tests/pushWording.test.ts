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
});
