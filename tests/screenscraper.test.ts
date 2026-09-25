import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SCREENSCRAPER_DEV_ID = 'dev-id';
process.env.SCREENSCRAPER_DEV_PASSWORD = 'dev-secret';
process.env.SCREENSCRAPER_USER = 'member';
process.env.SCREENSCRAPER_PASSWORD = 'member-secret';

import {
  ScreenScraperProvider, formatScreenScraperGame, coverMediaName, pickTagged, regionPriorities
} from '../plugins/games/screenscraper';

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

test('stops asking once the day\'s quota is spent', async () => {
  const calls = stubFetch(() => json({
    response: { jeux: [game], ssuser: { requeststoday: '100', maxrequestsperday: '100', maxthreads: '1' } }
  }));
  await new ScreenScraperProvider().search('sonic', {});
  await assert.rejects(new ScreenScraperProvider().search('sonic', {}), (err: any) => err.status === 430);
  assert.equal(calls.length, 1, 'the second search never reached ScreenScraper');
});
