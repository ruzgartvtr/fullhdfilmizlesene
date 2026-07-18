const assert = require('assert');
const scraper = require('../scraper');
const addon = require('../addon');
const customStreams = require('../customStreams');

async function run() {
  assert.strictEqual(scraper.rot13('uryyb'), 'hello');
  assert.strictEqual(customStreams.isDirectVideoUrl('https://example.com/video.mp4'), true);
  assert.strictEqual(customStreams.isDirectVideoUrl('https://example.com/live/index.m3u8?token=1'), true);
  assert.strictEqual(customStreams.isDirectVideoUrl('https://example.com/player/abc123'), false);
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

  const { findBestMatch } = addon._private;

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

  console.log('Scraper and matching checks passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
