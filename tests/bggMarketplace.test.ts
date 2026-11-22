import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MarketListing, createMarketplace, estimateFromListings, isBggId, parseMarketplace
} from '../plugins/boardgames/marketplace';

// The shape /thing?marketplace=1 answers with: a game with copies on sale, one with a
// single copy, and one nobody is selling, which comes without the element at all.
const xml = `<?xml version="1.0" encoding="utf-8"?><items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse"><item type="boardgame" id="2452">
         <thumbnail>https://cf.geekdo-images.com/thumb.jpg</thumbnail>
         <name type="primary" sortindex="1" value="Jenga" />
         <yearpublished value="1983" />
         <marketplacelistings>
              <listing>
         <listdate value="Fri, 13 Feb 2015 20:28:40 +0000" />
         <price currency="USD" value="15.00" />
           <condition value="likenew" />
         <notes value="Box Great
Components: complete" />
                  <link href="https://boardgamegeek.com/market/product/704491" title="marketlisting" />
       </listing>
              <listing>
         <listdate value="Sat, 21 Sep 2019 08:14:29 +0000" />
         <price currency="EUR" value="10.00" />
           <condition value="good" />
         <notes value="" />
                  <link href="https://boardgamegeek.com/market/product/1953093" title="marketlisting" />
       </listing>
              <listing>
         <listdate value="Thu, 01 Jan 2026 07:44:46 +0000" />
         <price currency="EUR" value="0.00" />
           <condition value="new" />
         <notes value="" />
                  <link href="https://boardgamegeek.com/market/product/4112002" title="marketlisting" />
       </listing>
         </marketplacelistings>
       </item><item type="boardgame" id="364766">
         <name type="primary" sortindex="1" value="MicroMacro: Crime City – All In" />
         <marketplacelistings>
              <listing>
         <listdate value="Tue, 27 Sep 2022 13:13:18 +0000" />
         <price currency="EUR" value="26.00" />
           <condition value="new" />
         <notes value="Brand new copy of the game, in shrink wrap." />
                  <link href="https://boardgamegeek.com/market/product/2974900" title="marketlisting" />
       </listing>
         </marketplacelistings>
       </item><item type="boardgameexpansion" id="285879">
         <name type="primary" sortindex="1" value="IT Startup: Corrupted data" />
         <link type="boardgamepublisher" id="4" value="(Self-Published)" />
       </item></items>`;

test('reads the copies on sale of every game in the answer', () => {
  const byId = parseMarketplace(xml);
  assert.deepEqual([...byId.keys()], ['2452', '364766', '285879']);
  // The copy priced at nothing is not an offer.
  assert.deepEqual(byId.get('2452'), [
    { price: 15, currency: 'USD', condition: 'likenew' },
    { price: 10, currency: 'EUR', condition: 'good' }
  ]);
  assert.deepEqual(byId.get('364766'), [{ price: 26, currency: 'EUR', condition: 'new' }]);
  assert.deepEqual(byId.get('285879'), []);
});

test('takes a list without games for what it is, and anything else for a failure', () => {
  const items = (inside: string) => `<?xml version="1.0" encoding="utf-8"?><items termsofuse="x">${inside}</items>`;
  // What BGG answers for an id it does not know, and for one it cannot read.
  assert.equal(parseMarketplace(items('')).size, 0);
  assert.equal(parseMarketplace(items("<item><error message='Invalid Item'/></item>")).get('13'), undefined);

  for (const other of [
    '',
    'Cannot load more than 20 items',
    '<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>',
    '<?xml version="1.0"?><error><message>Rate limit exceeded.</message></error>',
    // Cut short: inside a tag, after a whole game, and just before the end.
    items('<item type="boardgame" id="13"><marketplacelistings><listing><price currency="EU'),
    '<items><item type="boardgame" id="13"><name type="primary" value="Catan" /></item>',
    items('<item type="boardgame" id="13"></item>').slice(0, -1)
  ]) {
    assert.throws(() => parseMarketplace(other), `accepted: ${other.slice(0, 40)}`);
  }
});

test('leaves out a price that is not an amount', () => {
  const priced = (value: string) => parseMarketplace(`<items><item type="boardgame" id="13"><marketplacelistings>
    <listing><price currency="eur" value="${value}" /><condition value="good" /></listing>
  </marketplacelistings></item></items>`).get('13');
  assert.deepEqual(priced('12.50'), [{ price: 12.5, currency: 'EUR', condition: 'good' }]);
  for (const value of ['', 'abc', '0.00', '-5.00', '12,50', '1e999', 'Infinity']) assert.deepEqual(priced(value), [], value);
});

const copy = (price: number, currency = 'EUR', condition = 'verygood'): MarketListing =>
  ({ price, currency, condition });

test('takes the median asking price, whichever copy is cheapest or dearest', () => {
  assert.deepEqual(estimateFromListings([copy(20), copy(900), copy(5)], 'EUR'), { value: 20, count: 3 });
  assert.deepEqual(estimateFromListings([copy(10), copy(15), copy(20.5), copy(40)], 'EUR'), { value: 17.75, count: 4 });
});

test('never converts: only the copies priced in the reader\'s currency count', () => {
  const listings = [copy(30, 'USD'), copy(22, 'GBP'), copy(26, 'GBP'), copy(18, 'EUR')];
  assert.deepEqual(estimateFromListings(listings, 'GBP'), { value: 24, count: 2 });
  assert.equal(estimateFromListings(listings, 'PLN'), null);
  assert.equal(estimateFromListings([], 'EUR'), null);
});

test('prices a played copy, and falls back on sealed ones when nothing else is on sale', () => {
  const listings = [copy(60, 'EUR', 'new'), copy(55, 'EUR', 'new'), copy(30, 'EUR', 'likenew'), copy(20, 'EUR', 'acceptable')];
  assert.deepEqual(estimateFromListings(listings, 'EUR'), { value: 25, count: 2 });
  assert.deepEqual(estimateFromListings(listings.slice(0, 2), 'EUR'), { value: 57.5, count: 2 });
});

test('only a number written as BGG writes it is a BGG id', () => {
  assert.equal(isBggId('13'), true);
  assert.equal(isBggId(13), true);
  for (const other of ['', '0', '007', ' 13', '13\n', '13,14', '13&type=x', '1e3', '-13', '9'.repeat(11), 'catan', null, undefined]) {
    assert.equal(isBggId(other), false, String(other));
  }
});

// A marketplace whose calls to BGG are recorded, answering one listing per game asked
// for (none for the ids in `empty`), on a clock the test moves by hand and without the
// wait before a second try. `takes` is how long a call lasts on that clock.
function recorded(options: { empty?: string[]; failing?: () => boolean; takes?: number } = {}) {
  const calls: string[][] = [];
  let now = Date.UTC(2026, 10, 1);
  const market = createMarketplace(async ids => {
    calls.push(ids);
    now += options.takes || 0;
    if (options.failing?.()) throw new Error('HTTP error! status: 429');
    return new Map(ids.filter(id => !options.empty?.includes(id)).map(id => [id, [copy(Number(id))]]));
  }, () => now, 0);
  return { market, calls, advance: (ms: number) => { now += ms; } };
}

const ids = (count: number, from = 1) => Array.from({ length: count }, (_, i) => String(from + i));

test('asks BGG for a game together with the ones that follow it in the run', async () => {
  const { market, calls } = recorded();
  const run = ids(45);
  for (const id of run) {
    const [listing] = await market.listingsFor(id, run);
    assert.equal(listing!.price, Number(id));
  }
  assert.deepEqual(calls, [ids(20), ids(20, 21), ids(5, 41)]);
});

test('does not ask twice for a game listed twice, nor for one it already knows', async () => {
  const { market, calls } = recorded();
  await market.listingsFor('7');
  await market.listingsFor('5', ['5', '7', '5', '9']);
  assert.deepEqual(calls, [['7'], ['5', '9']]);
});

test('remembers a game nobody is selling', async () => {
  const { market, calls } = recorded({ empty: ['2'] });
  const run = ['1', '2', '3'];
  assert.equal((await market.listingsFor('1', run)).length, 1);
  assert.deepEqual(await market.listingsFor('2', run), []);
  assert.deepEqual(await market.listingsFor('2', run), []);
  assert.equal(calls.length, 1);
});

test('reads the listings again after an hour', async () => {
  const { market, calls, advance } = recorded();
  await market.listingsFor('1');
  advance(59 * 60 * 1000);
  await market.listingsFor('1');
  assert.equal(calls.length, 1);
  advance(60 * 1000);
  await market.listingsFor('1');
  assert.equal(calls.length, 2);
});

test('tries a failed call once more, so that one hiccup costs the run nothing', async () => {
  let failures = 1;
  const { market, calls } = recorded({ failing: () => failures-- > 0 });
  const run = ids(45);
  for (const id of run) assert.equal((await market.listingsFor(id, run)).length, 1);
  assert.deepEqual(calls, [ids(20), ids(20), ids(20, 21), ids(5, 41)]);
});

test('leaves BGG alone for the time of a batch once a call has failed twice', async () => {
  let failing = true;
  const { market, calls, advance } = recorded({ failing: () => failing });
  const run = ['1', '2', '3'];
  await assert.rejects(market.listingsFor('1', run), /429/);
  await assert.rejects(market.listingsFor('2', run), /unavailable/);
  assert.deepEqual(calls, [run, run]);

  failing = false;
  advance(10 * 1000 - 1);
  await assert.rejects(market.listingsFor('2', run), /unavailable/);
  advance(1);
  assert.equal((await market.listingsFor('2', run)).length, 1);
  assert.deepEqual(calls, [run, run, ['2', '3']]);
});

test('counts that time from the failure, however long the calls took to fail', async () => {
  // Two calls timing out after fifteen seconds each.
  const { market, calls, advance } = recorded({ failing: () => true, takes: 15 * 1000 });
  await assert.rejects(market.listingsFor('1', ['1', '2']), /429/);
  await assert.rejects(market.listingsFor('2', ['1', '2']), /unavailable/);
  advance(10 * 1000 - 1);
  await assert.rejects(market.listingsFor('2', ['1', '2']), /unavailable/);
  assert.equal(calls.length, 2);
});

test('still answers for the games it knows while BGG is left alone', async () => {
  let failing = false;
  const { market } = recorded({ failing: () => failing });
  await market.listingsFor('1', ['1']);
  failing = true;
  await assert.rejects(market.listingsFor('2', ['2']));
  assert.equal((await market.listingsFor('1', ['1'])).length, 1);
});
