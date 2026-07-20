const assert = require('assert');
const scraper = require('../scraper');
const addon = require('../addon');
const customStreams = require('../customStreams');
const proxy = require('../proxy');

async function run() {
  assert.strictEqual(scraper.rot13('uryyb'), 'hello');
  assert.strictEqual(addon._private.isYouTubeProviderEnabled(), true, 'YouTube streams should be on by default');
  assert.strictEqual(customStreams.isDirectVideoUrl('https://example.com/video.mp4'), true);
  assert.strictEqual(customStreams.isDirectVideoUrl('https://example.com/live/index.m3u8?token=1'), true);
  assert.strictEqual(customStreams.isDirectVideoUrl('https://cdn.example.com/m3u8/abc/master.txt?s=1'), true);
  assert.strictEqual(customStreams.isDirectVideoUrl('https://s10.picturebox.cloud/mi/test-token'), true);
  assert.strictEqual(customStreams.isDirectVideoUrl('https://81cdcd8d1.rupertes.ga/fw/test-token'), true);
  assert.strictEqual(customStreams.isDirectVideoUrl('https://fastplay.mom/video/abc123'), false);
  assert.strictEqual(customStreams.isDirectVideoUrl('http://127.0.0.1:7002/proxy/test'), true);
  assert.strictEqual(customStreams.isDirectVideoUrl('https://example.com/player/abc123'), false);

  assert.deepStrictEqual(
    addon._private.applyStreamPreferences([
      { title: 'YouTube', ytId: 'abc12345678' },
      { title: 'HLS', url: 'https://example.com/master.m3u8' }
    ]),
    [
      { title: 'YouTube', ytId: 'abc12345678' },
      { title: 'HLS', url: 'https://example.com/master.m3u8' }
    ],
    'YouTube streams should remain visible next to direct streams by default'
  );
  assert.deepStrictEqual(
    addon._private.applyStreamPreferences([{ title: 'YouTube', ytId: 'abc12345678' }]),
    [{ title: 'YouTube', ytId: 'abc12345678' }],
    'YouTube should remain only when there is no direct stream fallback'
  );

  const ataturkQueries = addon._private.buildSearchQueries('tt19394770', {
    name: 'Atatürk: 1881-1919',
    releaseInfo: '2023'
  });
  assert(ataturkQueries.includes('Atatürk: 1881-1919 2023'), 'Expected title+year query');
  assert(ataturkQueries.includes('Atatürk 1881 1919 2023'), 'Expected punctuation-free title+year query');
  assert(addon._private.getFastSearchQueries(ataturkQueries).length <= 5, 'Fast mode should cap search query fan-out');
  assert.strictEqual(
    addon._private.sortProvidersForSpeed([{ name: 'Filmmodu' }, { name: 'HDFilmCehennemi' }], 'movie')[0].name,
    'HDFilmCehennemi',
    'Movie fast path should prefer HDF when available'
  );
  assert.strictEqual(
    addon._private.getSearchProviders([{ name: 'HDFilmCehennemi' }, { name: 'FullHDFilm' }], 'movie', { hasLocalAliases: true, queryTitle: 'GORA' }).length,
    1,
    'Local movie fast path should search the top provider first'
  );
  assert.strictEqual(
    addon._private.getSearchProviders([
      { name: 'HDFilmCehennemi' },
      { name: 'FullHDFilm' },
      { name: 'JetFilm' },
      { name: 'Filmmodu' }
    ], 'movie', { hasLocalAliases: true, hasTurkishAliases: true, queryTitle: 'The Devil Wears Prada' }).length,
    4,
    'Foreign-title movies with Turkish aliases should keep broad provider coverage'
  );
  assert(addon._private.getTitleAliases('tt0458352', 'The Devil Wears Prada').includes('Şeytan Marka Giyer'), 'Expected Turkish Devil Wears Prada alias');
  assert.strictEqual(
    addon._private.getSearchProviders([
      { name: 'HDFilmCehennemi' },
      { name: 'FullHDFilm' },
      { name: 'JetFilm' },
      { name: 'Filmmodu' }
    ], 'movie', { hasLocalAliases: false, queryTitle: 'Inception' }).length,
    4,
    'Foreign movie fast path should keep broad provider coverage'
  );

  const ranked = addon._private.rankMatchesBySource([
    { source: 'HDFilmCehennemi', title: 'G.O.R.A.', year: 'N/A', url: 'https://example.com/dead' },
    { source: 'HDFilmCehennemi', title: 'G.O.R.A.', year: '2004', url: 'https://example.com/live' },
    { source: 'Filmmodu', title: 'G.O.R.A.', year: '2004', url: 'https://example.com/fm' }
  ], 'G.O.R.A.', '2004', { maxPerSource: 3 });
  assert.strictEqual(ranked.get('HDFilmCehennemi').length, 2, 'Expected backup candidates from same source');

  const rewritten = proxy.rewriteM3u8('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nchunk1.m4s', 'https://cdn.example.com/path/master.m3u8', 'https://ref.example.com/');
  assert(rewritten.includes('/proxy/'), 'Expected HLS media URLs to be proxied');
  assert(!rewritten.includes('URI="init.mp4"'), 'Expected EXT-X-MAP URI to be rewritten');
  assert.deepStrictEqual(
    customStreams.toStremioStream({
      name: 'Test',
      title: '720p',
      url: 'https://example.com/video.mp4'
    }),
    {
      name: 'Test',
      title: '720p',
      url: 'https://example.com/video.mp4'
    }
  );

  const { findBestMatch, findBestMatchesBySource } = addon._private;

  const wrongInceptionResults = await scraper.searchMovies('Inception');
  assert.strictEqual(
    findBestMatch(wrongInceptionResults, 'Inception', '2010'),
    null,
    'English-title searches must not fall back to an unrelated first result'
  );

  const tenetResults = await scraper.searchMovies('Tenet');
  const tenetMatch = findBestMatch(tenetResults, 'Tenet', '2020');
  assert(tenetMatch, 'Expected a confident Tenet match');
  assert.strictEqual(tenetMatch.year, '2020');

  const avatarResults = await scraper.searchMovies('Avatar');
  const avatarMatch = findBestMatch(avatarResults, 'Avatar', '2009');
  assert(avatarMatch, 'Expected Avatar 2009 to match by title and year');
  assert.strictEqual(avatarMatch.year, '2009');

  const inceptionResults = await scraper.searchMoviesMany(['tt1375666', 'Inception']);
  const inceptionMatch = findBestMatch(inceptionResults, 'Inception', '2010', {
    imdbId: 'tt1375666',
    imdbRating: '8.8'
  });
  assert(inceptionMatch, 'Expected IMDb ID search to match the localized Inception title');
  assert.strictEqual(inceptionMatch.title, 'Başlangıç izle');

  const mastersMatches = findBestMatchesBySource([
    {
      source: 'JetFilm',
      title: 'Kainatın Hakimleri',
      year: '2026',
      imdb: 'N/A',
      query: 'tt0427340',
      url: 'https://example.com/kainatin-hakimleri'
    },
    {
      source: 'FullHDFilm',
      title: 'Masters of the Universe izle',
      year: '2026',
      imdb: '7.1',
      query: 'Masters of the Universe',
      url: 'https://example.com/masters-2026'
    },
    {
      source: 'Filmmodu',
      title: 'Masters of the Universe',
      year: '1987',
      imdb: '5.3',
      query: 'Masters of the Universe',
      url: 'https://example.com/masters-1987'
    }
  ], 'Masters of the Universe', '2026', {
    imdbId: 'tt0427340',
    imdbRating: '6.9'
  });

  assert.strictEqual(mastersMatches.length, 2, 'Expected only safe Masters 2026 matches');
  assert(mastersMatches.some((match) => match.source === 'JetFilm'), 'Expected IMDb+year localized title match');
  assert(mastersMatches.some((match) => match.source === 'FullHDFilm'), 'Expected exact title+year match');
  assert(!mastersMatches.some((match) => match.url.includes('masters-1987')), 'Must not include wrong-year first result');

  const goraMatches = findBestMatchesBySource([
    {
      source: 'HDFilmCehennemi',
      title: 'G.O.R.A.',
      year: 'N/A',
      imdb: 'N/A',
      query: 'tt0384116',
      url: 'https://example.com/gora'
    },
    {
      source: 'FullHDFilm',
      title: 'Agora izle',
      year: '2009',
      imdb: '7.1',
      query: 'GORA',
      url: 'https://example.com/agora'
    }
  ], 'G.O.R.A.', '2004', {
    imdbId: 'tt0384116',
    imdbRating: '8.0'
  });

  assert.strictEqual(goraMatches.length, 1, 'Expected exact IMDb-query match even when provider omits year');
  assert.strictEqual(goraMatches[0].source, 'HDFilmCehennemi');

  console.log('Scraper and matching checks passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
