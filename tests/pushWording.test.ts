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

  it('titles a push with what it is about, never with the site', () => {
    const row = { event: 'request.received', payload: { actor: "Kyo'", kind: 'Emprunter', item: 'Charizard ex', quote: 'Je te le rends vite !' } };
    assert.deepEqual(pushWording(row, fr, 'Vinyl'), { title: 'Emprunter · Charizard ex', body: "Kyo' vous envoie une demande\n« Je te le rends vite ! »" });
    assert.equal(pushWording(row, en).body, "Kyo' sent you a request\n“Je te le rends vite !”");
  });

  it('says the step reached, and the due date of a late one', () => {
    assert.equal(pushWording({ event: 'request.step', payload: { actor: 'Alex', kind: 'Emprunter', item: 'Dune', step: 'Rendu' } }, fr).body, 'Rendu, marqué par Alex');
    assert.equal(pushWording({ event: 'request.overdue', payload: { kind: 'Emprunter', item: 'Dune', due: '2026-10-20' } }, fr).body, 'Échéance le 20 octobre : c\'est en retard');
  });

  it('cuts a long quote and keeps the title when the item is unknown', () => {
    const long = 'a'.repeat(400);
    const { title, body } = pushWording({ event: 'request.declined', payload: { actor: 'Alex', quote: long } }, fr, 'Vinyl');
    assert.equal(title, 'Vinyl');
    assert.ok(body.length < 200);
    assert.ok(body.endsWith('… »'));
  });
});
