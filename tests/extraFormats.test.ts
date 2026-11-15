import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addExtraFormatsField, allowsExtraFormats, extraFormatsOf, holdsFormat, parseExtraFormats, EXTRA_FORMATS_FIELD
} from '../core/extraFormats';
import { otherMediaFromDiscogs } from '../plugins/music/formatDetails';

const films: any = {
  multipleFormats: true,
  formats: [{ value: 'dvd' }, { value: 'bluray' }, { value: '4k' }],
  formFields: [{ name: 'title' }, { name: 'format' }, { name: 'media_type' }, { name: 'location' }]
};

test('an edition holds its own format and the others it lists', () => {
  const box = { format: '4k', extra_formats: ['bluray', '4K', 'bluray', ''] };
  assert.deepEqual(extraFormatsOf(box), ['bluray']);
  assert.equal(holdsFormat(box, '4k'), true);
  assert.equal(holdsFormat(box, 'BluRay'), true);
  assert.equal(holdsFormat(box, 'dvd'), false);
  assert.equal(holdsFormat({ media_type: 'vinyl', extra_formats: ['cd'] }, 'cd'), true);
  assert.equal(holdsFormat({ format: 'dvd' }, ''), false);
});

test('a posted list keeps only the type\'s formats other than the main one', () => {
  assert.deepEqual(parseExtraFormats(['', 'bluray', '4k', 'vhs', 'bluray'], films, '4k'), ['bluray']);
  assert.deepEqual(parseExtraFormats('', films, 'dvd'), []);
  assert.deepEqual(parseExtraFormats('DVD, bluray', films, '4k'), ['dvd', 'bluray']);
  assert.deepEqual(parseExtraFormats(undefined, films, 'dvd'), []);
});

test('the field is added after the format select, only to a type that allows it', () => {
  const plugin: any = { ...films, formFields: [...films.formFields] };
  addExtraFormatsField(plugin);
  addExtraFormatsField(plugin);
  assert.deepEqual(plugin.formFields.map((f: any) => f.name), ['title', 'format', EXTRA_FORMATS_FIELD, 'media_type', 'location']);

  const lego: any = { formats: [{ value: 'sealed' }, { value: 'built' }], formFields: [{ name: 'format' }] };
  addExtraFormatsField(lego);
  assert.equal(allowsExtraFormats(lego), false);
  assert.deepEqual(lego.formFields.map((f: any) => f.name), ['format']);

  const music: any = { multipleFormats: true, formats: [{ value: 'vinyl' }, { value: 'cd' }], formFields: [{ name: 'media_type' }, { name: 'format_type' }] };
  addExtraFormatsField(music);
  assert.deepEqual(music.formFields.map((f: any) => f.name), ['media_type', EXTRA_FORMATS_FIELD, 'format_type']);
});

test('the other media of a Discogs release are read off its format names', () => {
  const formats = [{ name: 'Vinyl' }, { name: 'CD' }, { name: 'DVD' }, { name: 'File' }, { name: 'CDr' }];
  assert.deepEqual(otherMediaFromDiscogs(formats, 'vinyl'), ['cd', 'digital']);
  assert.deepEqual(otherMediaFromDiscogs(formats, 'cd'), ['vinyl', 'digital']);
  assert.deepEqual(otherMediaFromDiscogs([{ name: 'Cassette' }], 'cassette'), []);
  assert.deepEqual(otherMediaFromDiscogs(undefined, 'vinyl'), []);
});
