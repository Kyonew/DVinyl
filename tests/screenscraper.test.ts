import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SCREENSCRAPER_DEV_ID = 'dev-id';
process.env.SCREENSCRAPER_DEV_PASSWORD = 'dev-secret';
process.env.SCREENSCRAPER_USER = 'member';
process.env.SCREENSCRAPER_PASSWORD = 'member-secret';

import {
  ScreenScraperProvider, formatScreenScraperGame, coverMediaName, pickTagged, regionPriorities,
  parseSystems, matchSystem, screenScraperQuery, mainTitle
} from '../plugins/games/screenscraper';
import { decodeHtmlEntities } from '../core/helpers';

// The shape jeuInfos / jeuRecherche answer with in JSON. Media addresses carry the
// credentials, exactly as the real API writes them.
const secretUrl = (media: string) =>
  `https://neoclone.screenscraper.fr/api2/mediaJeu.php?devid=dev-id&devpassword=dev-secret&softname=x&ssid=member&sspassword=member-secret&systemeid=1&jeuid=3&media=${media}`;

const game = {
  id: '3',
  noms: [
    { region: 'ss', text: 'Sonic The Hedgehog 2' },
    { region: 'eu', text: 'Sonic The Hedgehog 2 (EU)' },
    { region: 'us', text: 'Sonic The Hedgehog 2 (US)' }
  ],
  systeme: { id: '1', text: 'Megadrive' },
  editeur: { id: '1', text: 'SEGA' },
  developpeur: { id: '2', text: 'Sonic Team' },
  joueurs: { text: '1-2' },
  synopsis: [
    { langue: 'en', text: 'Dr. Robotnik is back.' },
    { langue: 'fr', text: 'Le Dr Robotnik est de retour.' }
  ],
  dates: [{ region: 'jp', text: '1992-11-21' }, { region: 'eu', text: '1992-11-24' }],
  genres: [
    { id: '7', noms: [{ langue: 'en', text: 'Platform' }, { langue: 'fr', text: 'Plateforme' }] },
    { id: '8', noms: [{ langue: 'en', text: 'Action' }] }
  ],
  medias: [
    { type: 'ss', region: 'wor', url: secretUrl('ss(wor)'), format: 'png' },
    { type: 'box-2D', region: 'us', url: secretUrl('box-2D(us)'), format: 'png' },
    { type: 'box-2D', region: 'eu', url: secretUrl('box-2D(eu)'), format: 'png' }
  ]
};

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(answer: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    calls.push(url);
    return answer(url);
  }) as any;
  return calls;
}

test('reads names, dates and box art in the reader\'s regional order', () => {
  const fr = formatScreenScraperGame(game, 'fr')!;
  assert.equal(fr.title, 'Sonic The Hedgehog 2 (EU)');
  assert.equal(fr.year, '1992');
  assert.equal(fr.description, 'Le Dr Robotnik est de retour.');
  assert.deepEqual(fr.genres, ['Plateforme', 'Action']);
  assert.equal(fr.platform, 'Megadrive');
  assert.equal(fr.developer, 'Sonic Team');
  assert.equal(fr.publisher, 'SEGA');

  const en = formatScreenScraperGame(game, 'en')!;
  assert.equal(en.title, 'Sonic The Hedgehog 2 (US)');
  assert.equal(en.description, 'Dr. Robotnik is back.');

  assert.equal(coverMediaName(game.medias, regionPriorities('fr')), 'box-2D(eu)');
  assert.equal(coverMediaName(game.medias, regionPriorities('en')), 'box-2D(us)');
  assert.equal(coverMediaName([{ type: 'ss', region: 'wor' }], regionPriorities('fr')), 'ss(wor)');
  assert.equal(coverMediaName([], regionPriorities('fr')), null);
  assert.equal(pickTagged([{ region: 'jp', text: 'only one' }], 'region', ['fr']), 'only one');
});

test('search results point at the relay route and never carry a credential', async () => {
  const calls = stubFetch(() => json({ response: { jeux: [game, {}] } }));
  const results = await new ScreenScraperProvider().search('sonic 2', { language: 'fr' });

  assert.equal(results.length, 1, 'the empty game ScreenScraper pads a result list with is dropped');
  assert.match(results[0]!.cover_image!, /\/api\/games\/screenscraper\/media\?system=1&game=3&media=box-2D%28eu%29$/);
  assert.doesNotMatch(JSON.stringify(results), /dev-secret|member-secret|devpassword|sspassword/);

  const sent = calls[0]!;
  assert.equal(sent.pathname, '/api2/jeuRecherche.php');
  assert.equal(sent.searchParams.get('recherche'), 'sonic 2');
  assert.equal(sent.searchParams.get('devid'), 'dev-id');
  assert.equal(sent.searchParams.get('ssid'), 'member');
  assert.equal(sent.searchParams.get('output'), 'json');
});

test('details ask by game id, and a game with no picture keeps an empty cover', async () => {
  const calls = stubFetch(url => url.pathname.endsWith('mediaJeu.php')
    ? new Response('NOMEDIA', { status: 200, headers: { 'content-type': 'text/html' } })
    : json({ response: { jeu: game } }));
  const details = await new ScreenScraperProvider().getDetails('3', { language: 'fr' });

  assert.equal(details.title, 'Sonic The Hedgehog 2 (EU)');
  assert.equal(details.cover_image, '');
  assert.equal(calls[0]!.searchParams.get('gameid'), '3');
  assert.equal(calls[1]!.searchParams.get('media'), 'box-2D(eu)');
  assert.equal(calls[1]!.searchParams.get('outputformat'), 'jpg');
  assert.doesNotMatch(JSON.stringify(details), /dev-secret|member-secret/);

  await assert.rejects(new ScreenScraperProvider().getDetails('3; drop', {}), /Invalid ScreenScraper id/);
});

test('a refusal is reported by status, without echoing the request', async () => {
  stubFetch(() => new Response('Erreur de login : Vérifier vos identifiants développeur !', { status: 403 }));
  await assert.rejects(
    new ScreenScraperProvider().search('x', {}),
    (err: any) => err.status === 403 && !/dev-secret|devpassword|Erreur/.test(err.message)
  );

  stubFetch(() => new Response('', { status: 429 }));
  await assert.rejects(new ScreenScraperProvider().search('x', {}), (err: any) => err.status === 429);

  // What the live API actually does with a bad developer pair: a 200 and a line of text.
  stubFetch(() => new Response('Erreur de login : Vérifier vos identifiants développeur !  ', { status: 200 }));
  await assert.rejects(new ScreenScraperProvider().search('x', {}), (err: any) => err.status === 403);
});

// Entries of systemesListe.php as the live API writes them, media left out.
const systemList = [
  { id: 1, noms: { nom_eu: 'Megadrive', nom_us: 'Genesis', nom_recalbox: 'megadrive', nom_retropie: 'genesis,megadrive', nom_launchbox: 'Sega Genesis', nom_hyperspin: 'Sega Genesis', noms_commun: 'Sega Megadrive,Sega Genesis,Megadrive,Genesis,Super Aladdin Boy' } },
  { id: 203, noms: { nom_eu: 'Megadrive - Sonic The Hedgehog 2 Hacks', nom_recalbox: 'megadrive', noms_commun: 'Megadrive,Genesis' } },
  { id: 6, noms: { nom_eu: 'Capcom Play System', nom_recalbox: 'arcade,mame,fba', nom_launchbox: 'Capcom Play System', noms_commun: 'Capcom Play System,CPS 1' } },
  { id: 47, noms: { nom_eu: 'Cave', nom_recalbox: 'arcade,mame,fba', nom_launchbox: 'arcade', noms_commun: 'Cave' } },
  { id: 49, noms: { nom_eu: 'Daphne', nom_recalbox: 'daphne,arcade,mame', nom_launchbox: 'arcade', noms_commun: 'Daphne' } },
  { id: 135, noms: { nom_eu: 'PC Dos', nom_recalbox: 'dos', nom_launchbox: 'MS-DOS', noms_commun: 'Microsoft MS-DOS,DOS,MS-DOS,PC-DOS,PC' } },
  { id: 138, noms: { nom_eu: 'PC Windows', nom_launchbox: 'Windows', noms_commun: 'Microsoft Windows,Windows,Windows XP' } },
  { id: 225, noms: { nom_eu: 'Switch', nom_launchbox: 'Nintendo Switch' } }
];

test('names a system from the way IGDB, Libib or a spreadsheet spell its platform', () => {
  const systems = parseSystems(systemList);
  assert.deepEqual(systems.map(s => s.id), ['1', '6', '47', '49', '135', '138', '225'], 'ROM hack collections are not systems anyone owns');

  assert.equal(matchSystem('Sega Mega Drive/Genesis', systems), '1');
  assert.equal(matchSystem('mega-drive', systems), '1');
  assert.equal(matchSystem('Nintendo Switch', systems), '225');
  assert.equal(matchSystem('MS-DOS', systems), '135');
  // "PC" is a Windows game in DVinyl, not the MS-DOS one ScreenScraper's names suggest.
  assert.equal(matchSystem('PC', systems), '138');
  assert.equal(matchSystem('PC (Microsoft Windows)', systems), '138');
  // A name several systems answer to picks none of them.
  assert.equal(matchSystem('Arcade', systems), '');
  assert.equal(matchSystem('Xbox Series X|S', systems), '');
});

test('searches within the system picked on the add page', async () => {
  const calls = stubFetch(() => json({ response: { jeux: [game] } }));
  await new ScreenScraperProvider().search('sonic', { platform: '1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.searchParams.get('systemeid'), '1');

  await new ScreenScraperProvider().search('sonic', {});
  assert.equal(calls[1]!.searchParams.get('systemeid'), null);
});

test('an imported platform name is looked up in a system list fetched once', async () => {
  const calls = stubFetch(url => url.pathname.endsWith('systemesListe.php')
    ? json({ response: { systemes: systemList } })
    : json({ response: { jeux: [game] } }));
  await new ScreenScraperProvider().search('sonic', { platform: 'Sega Genesis' });
  await new ScreenScraperProvider().search('doom', { platform: 'MS-DOS' });
  await new ScreenScraperProvider().search('metal slug', { platform: 'Arcade' });

  const lists = calls.filter(url => url.pathname.endsWith('systemesListe.php'));
  const searches = calls.filter(url => url.pathname.endsWith('jeuRecherche.php'));
  assert.equal(lists.length, 1);
  assert.deepEqual(searches.map(url => url.searchParams.get('systemeid')), ['1', '135', null]);
});

test('spaces a title\'s colons, and falls back on its main title once when it finds nothing', async () => {
  assert.equal(screenScraperQuery('The Legend of Zelda: A Link to the Past'), 'The Legend of Zelda : A Link to the Past');
  assert.equal(screenScraperQuery(' Sonic 2 '), 'Sonic 2');
  assert.equal(mainTitle('Street Fighter II: The World Warrior'), 'Street Fighter II');
  assert.equal(mainTitle('Castlevania - Symphony of the Night'), 'Castlevania');
  assert.equal(mainTitle('Sonic the Hedgehog 2'), '');
  assert.equal(mainTitle('X: Beyond the Frontier'), '', 'too short a name to search on');

  const calls = stubFetch(url => json({
    response: { jeux: url.searchParams.get('recherche') === 'Street Fighter II' ? [game] : [{}] }
  }));
  const results = await new ScreenScraperProvider().search('Street Fighter II: The World Warrior', { platform: '1' });
  assert.equal(results.length, 1);
  assert.deepEqual(calls.map(url => url.searchParams.get('recherche')), ['Street Fighter II : The World Warrior', 'Street Fighter II']);
  assert.ok(calls.every(url => url.searchParams.get('systemeid') === '1'), 'the retry stays in the system asked for');

  const once = stubFetch(() => json({ response: { jeux: [game] } }));
  await new ScreenScraperProvider().search('Sonic: The Hedgehog', { platform: '1' });
  assert.equal(once.length, 1, 'a search that finds something is not repeated');
});

test('decodes the HTML entities ScreenScraper escapes its texts with', () => {
  const escaped = {
    ...game,
    noms: [{ region: 'eu', text: 'Tom &amp; Jerry' }],
    synopsis: [{ langue: 'fr', text: 'Son ami &quot;Tails&quot; l&#039;accompagne&#8230;' }],
    developpeur: { id: '2', text: 'Brøderbund &amp; Co' }
  };
  const fr = formatScreenScraperGame(escaped, 'fr')!;
  assert.equal(fr.title, 'Tom & Jerry');
  assert.equal(fr.description, "Son ami \"Tails\" l'accompagne…");
  assert.equal(fr.developer, 'Brøderbund & Co');

  assert.equal(decodeHtmlEntities('&amp;quot;'), '&quot;', 'one pass only');
  assert.equal(decodeHtmlEntities('&#x1F3AE; &#99999999; &unknown;'), '🎮 &#99999999; &unknown;');
});

test('stops asking once the day\'s quota is spent', async () => {
  const calls = stubFetch(() => json({
    response: { jeux: [game], ssuser: { requeststoday: '100', maxrequestsperday: '100', maxthreads: '1' } }
  }));
  await new ScreenScraperProvider().search('sonic', {});
  await assert.rejects(new ScreenScraperProvider().search('sonic', {}), (err: any) => err.status === 430);
  assert.equal(calls.length, 1, 'the second search never reached ScreenScraper');
});
