import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanProductTitle } from '../core/helpers';

// The noise words the DVD plugin declares. Kept here so a change to the plugin list
// shows up as a failing expectation rather than a silently different test.
const DVD_NOISE = [
  'DVD', 'Blu-ray', 'Blu Ray', 'Bluray', '4K', 'UHD', 'Ultra HD', 'Coffret',
  'Edition', 'Édition', 'Steelbook', 'Combo',
  'Region A', 'Region B', 'Region C', 'Region Free', 'Region 1', 'Region 2', 'Region 4',
  'Pre-order', 'Preorder'
];

test('drops a plus-delimited seller qualifier and the region/format words inside it', () => {
  assert.equal(
    cleanProductTitle('Classic Hitchcock (collection) +region B Bluray Pre-order+', DVD_NOISE),
    'Classic Hitchcock'
  );
  assert.equal(
    cleanProductTitle('Back to the Future: The Complete Trilogy DVD', DVD_NOISE),
    'Back to the Future: The Complete Trilogy'
  );
  assert.equal(
    cleanProductTitle('Spider-Man: No Way Home + Bonus Disc +', DVD_NOISE),
    'Spider-Man: No Way Home'
  );
});

test('drops bracketed edition and region labels', () => {
  assert.equal(
    cleanProductTitle('The Alfred Hitchcock Classics Collection [Blu-ray] [Region B]', DVD_NOISE),
    'The Alfred Hitchcock Classics Collection'
  );
});

test('drops a region or pre-order qualifier even without plus signs', () => {
  assert.equal(cleanProductTitle('Blade Runner 2049 4K UHD Region Free', DVD_NOISE), 'Blade Runner 2049');
  assert.equal(cleanProductTitle('Dune Pre-order Blu-ray', DVD_NOISE), 'Dune');
});

test('leaves a title that genuinely carries a plus sign alone', () => {
  assert.equal(cleanProductTitle('C++ Primer', DVD_NOISE), 'C++ Primer');
  assert.equal(cleanProductTitle('Rock + Roll', DVD_NOISE), 'Rock + Roll');
});
