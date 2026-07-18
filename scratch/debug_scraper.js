const scraper = require('../scraper');

async function test() {
  const movieUrl = 'https://www.fullhdfilmizlesene.nz/film/avatar-2/';
  console.log(`Getting streams for: Avatar (2009) (${movieUrl})`);
  const streams = await scraper.getStreams(movieUrl);
  console.log('Scraped Streams:');
  console.log(JSON.stringify(streams, null, 2));
}

test().catch(console.error);
