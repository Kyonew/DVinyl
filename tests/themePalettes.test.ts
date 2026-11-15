import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePalettes, palettesFromForm, themeNameFor, themeChoiceFor, resolveTheme, isThemeChoice, MAX_PALETTES
} from '../core/theme';
import { readPack, packUpdate } from '../core/layoutPacks';
import { LOOK_STYLES, lookStyleFields } from '../core/lookStyles';

const red = {
  light: { bg: '#fff4f3', card: '#ffffff', navbar: '#fee4e1', text: '#331513', subtext: '#794d49', highlight: '#dc2626' },
  dark: { bg: '#200b0a', card: '#2b1210', navbar: '#160706', text: '#fff7f6', subtext: '#e2c7c4', highlight: '#ef4444' }
};
const env: any = { settings: {}, registry: { getAll: () => [], getEnabled: () => [] }, t: (key: string) => key };

test('the single palette of old reads as the first of the list while something wears it', () => {
  const worn = normalizePalettes({ customTheme: red, theme: { home: { preset: 'custom' } } });
  assert.equal(worn.length, 1);
  assert.equal(worn[0]!.dark.highlight, '#ef4444');
  assert.deepEqual(normalizePalettes({ customTheme: red, theme: { home: { preset: 'emerald' } } }), []);
  // Once the list is saved, the old palette is never read again, even emptied.
  assert.deepEqual(normalizePalettes({ customThemes: [], customTheme: red, theme: { home: { preset: 'custom' } } }), []);
});

test('an old palette keeps drawing the pages that wear it', () => {
  const settings = { customTheme: red, theme: { home: { preset: 'custom' }, music: { preset: 'default' } } };
  assert.equal(themeNameFor(settings, 'home'), 'custom:mine');
  assert.equal(resolveTheme(settings, 'home').dark.highlight, '#ef4444');
  assert.equal(themeChoiceFor(settings, 'home'), 'custom:mine');
  assert.equal(themeChoiceFor(settings, 'music'), 'default');
});

test('the posted list keeps only valid palettes, up to the limit', () => {
  const posted = [
    { id: 'abc', name: '  Red   sleeve ', ...red },
    { id: 'abc', name: 'twice', ...red },
    { id: 'Bad Id!', name: 'x', ...red },
    { id: 'evil', name: 'x', light: { bg: 'url(javascript:alert(1))' }, dark: {} },
    ...Array.from({ length: 20 }, (_, i) => ({ id: 'p' + i, name: '', ...red }))
  ];
  const list = palettesFromForm({ customThemes: JSON.stringify(posted) });
  assert.equal(list.length, MAX_PALETTES);
  assert.equal(list[0]!.name, 'Red sleeve');
  assert.equal(list.filter(p => p.id === 'abc').length, 1);
  assert.ok(!list.some(p => p.id === 'Bad Id!'));
  assert.match(list.find(p => p.id === 'evil')!.light.bg, /^#[0-9a-f]{6}$/);
  assert.deepEqual(palettesFromForm({ customThemes: '{not json' }), []);
});

test('an item type follows the home page unless it has a theme of its own', () => {
  const settings = {
    customThemes: [{ id: 'abc', name: 'Red', ...red }],
    theme: { home: { preset: 'custom:abc' }, music: { preset: 'inherit' }, books: { preset: 'amber' }, dvd: { preset: 'custom:abc' }, games: { preset: 'custom:gone' } }
  };
  assert.equal(themeNameFor(settings, 'music'), 'custom:abc');
  assert.equal(themeNameFor(settings, 'books'), 'amber');
  assert.equal(themeNameFor(settings, 'games'), 'custom:abc', 'a palette deleted falls back to the home page');
  assert.equal(themeChoiceFor(settings, 'dvd'), 'inherit', 'the same theme as the home page reads as following it');
  assert.equal(themeChoiceFor(settings, 'books'), 'amber');
  assert.ok(isThemeChoice('inherit'));
  assert.ok(!isThemeChoice('custom:'));
  // The home page itself never inherits.
  assert.equal(themeNameFor({ theme: { home: { preset: 'inherit' } } }, 'home'), 'default');
});

test('a pack brings its palettes in under new names, reusing the same colours', () => {
  const pack = {
    format: 'dvinyl-look', version: 1, name: 'x',
    colors: { home: 'custom:zz', music: 'inherit', books: 'custom:nope' },
    palettes: [{ id: 'zz', name: 'Red', ...red }]
  };
  const { parts } = readPack(pack, env, ['default', 'amber'], ['music', 'books']);
  assert.deepEqual(Object.keys(parts.colors!), ['home', 'music'], 'a palette the pack lacks is dropped');

  const fresh = packUpdate(parts, ['colors'], { customThemes: [] });
  assert.equal(fresh.customThemes.length, 1);
  assert.notEqual(fresh.customThemes[0].id, 'zz');
  assert.equal(fresh['theme.home.preset'], 'custom:' + fresh.customThemes[0].id);
  assert.equal(fresh['theme.music.preset'], 'inherit');

  const again = packUpdate(parts, ['colors'], { customThemes: [{ id: 'mine1', name: 'Mine', ...red }] });
  assert.equal(again.customThemes, undefined, 'the same colours are reused, the list untouched');
  assert.equal(again['theme.home.preset'], 'custom:mine1');
});

test('a pack of old brings its single palette', () => {
  const pack = { format: 'dvinyl-look', version: 1, name: 'x', colors: { home: 'custom' }, customTheme: red };
  const { parts } = readPack(pack, env, ['default'], []);
  const update = packUpdate(parts, ['colors'], {});
  assert.equal(update.customThemes.length, 1);
  assert.equal(update.customThemes[0].dark.highlight, '#ef4444');
  assert.equal(update['theme.home.preset'], 'custom:' + update.customThemes[0].id);
});

test('a style leaves out the options of a background it does not draw', () => {
  const classic = lookStyleFields(LOOK_STYLES.find(s => s.id === 'classic')!);
  assert.equal(classic.ambience_background, 'plain');
  assert.ok(!('ambience_gradient' in classic) && !('ambience_intensity' in classic));
  const neon = lookStyleFields(LOOK_STYLES.find(s => s.id === 'neon')!);
  assert.equal(neon.ambience_gradient, 'aurora');
  assert.equal(neon.layout_headingCase, 'upper');
  assert.equal(neon.ambience_glass, 'on');
  assert.ok(!('layout_nav' in neon), 'a style never moves the navigation');
});
