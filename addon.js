const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const scraper = require('./scraper');
const customStreams = require('./customStreams');

const CINEMETA_URL = 'https://v3-cinemeta.strem.io/meta';

const manifest = {
  id: 'community.fullhdfilmizlesene',
  version: '1.0.0',
  name: 'FullHDFilmizlesene Addon',
  description: 'Turkish Dubbed & Subtitled movies from fullhdfilmizlesene.nz',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  background: 'https://img.fullhdfilmizlesene.nz/temalar/flex/images/default_user.svg',
  logo: 'https://img.fullhdfilmizlesene.nz/favicon-32x32.png',
  catalogs: []
};

const builder = new addonBuilder(manifest);

// Helper function to resolve IMDb ID to Movie metadata (Name & Year) via Cinemeta
async function getMetaFromImdb(type, imdbId) {
  try {
    const url = `${CINEMETA_URL}/${type}/${imdbId}.json`;
    const response = await axios.get(url);
    if (response.data && response.data.meta) {
      return response.data.meta;
    }
  } catch (error) {
    console.error(`Failed to fetch cinemeta for ${imdbId}:`, error.message);
  }
  return null;
}

// Normalize strings for comparison
function cleanTitle(title = '') {
  return title
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\bizle\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isYearMatch(resultYear, queryYear) {
  return Boolean(queryYear && resultYear && String(resultYear).trim() === String(queryYear).trim());
}

function getTitleScore(resultTitle, queryTitle) {
  const cleanResult = cleanTitle(resultTitle);
  const cleanQuery = cleanTitle(queryTitle);

  if (!cleanResult || !cleanQuery) return 0;
  if (cleanResult === cleanQuery) return 100;

  const parts = resultTitle
    .split(/\s+-\s+| - |-/)
    .map(cleanTitle)
    .filter(Boolean);

  if (parts.includes(cleanQuery)) return 95;
  if (cleanResult.includes(` ${cleanQuery} `) || cleanResult.startsWith(`${cleanQuery} `) || cleanResult.endsWith(` ${cleanQuery}`)) return 85;

  return 0;
}

function findBestMatch(searchResults, queryTitle, queryYear) {
  return searchResults
    .map((result) => ({
      result,
      titleScore: getTitleScore(result.title, queryTitle),
      yearMatches: isYearMatch(result.year, queryYear)
    }))
    .filter((candidate) => candidate.titleScore >= 85 && candidate.yearMatches)
    .sort((a, b) => b.titleScore - a.titleScore)[0]?.result || null;
}

builder.defineStreamHandler(async (args) => {
  const { type, id } = args; // id is IMDb ID, e.g. tt0087175, or tt0087175:1:1 for series
  console.log(`Received stream request for type: ${type}, id: ${id}`);

  let imdbId = id;
  let season = null;
  let episode = null;

  if (id.includes(':')) {
    const parts = id.split(':');
    imdbId = parts[0];
    season = parts[1];
    episode = parts[2];
  }

  const localStreams = customStreams.getCustomStreams(id);
  if (localStreams.length > 0) {
    console.log(`Found ${localStreams.length} custom direct streams for ${id}`);
    return { streams: localStreams };
  }

  if (type === 'series') {
    console.log(`Series requests are not supported yet. IMDb ID: ${imdbId}, S${season || '?'}E${episode || '?'}`);
    return { streams: [] };
  }

  // 1. Resolve IMDb ID to movie/series info
  const meta = await getMetaFromImdb(type === 'series' ? 'series' : 'movie', imdbId);
  if (!meta || !meta.name) {
    console.log(`Could not resolve meta for IMDb ID: ${imdbId}`);
    return { streams: [] };
  }

  const queryTitle = meta.name;
  const queryYear = meta.year ? meta.year.split('–')[0].trim() : '';
  console.log(`Resolved Meta - Title: "${queryTitle}", Year: "${queryYear}"`);

  // 2. Search for the title on fullhdfilmizlesene.nz
  const searchResults = await scraper.searchMovies(queryTitle);
  console.log(`Found ${searchResults.length} search results on FullHDFilmizlesene`);

  if (searchResults.length === 0) {
    return { streams: [] };
  }

  // 3. Find a confident match. Do not fall back to the first result:
  // that can make Stremio show a stream for the wrong movie.
  const bestMatch = findBestMatch(searchResults, queryTitle, queryYear);

  if (!bestMatch) {
    console.log(`No confident match for "${queryTitle}" (${queryYear}). Returning no streams.`);
    return { streams: [] };
  }

  console.log(`Selected Match: "${bestMatch.title}" - URL: ${bestMatch.url}`);

  // 4. Scrape stream URLs
  const scrapedStreams = await scraper.getStreams(bestMatch.url);
  console.log(`Scraped ${scrapedStreams.length} stream links from page`);

  const streams = scrapedStreams.map((s) => {
    // Stremio can play direct video URLs. Embedded player pages stay external.
    if (customStreams.isDirectVideoUrl(s.url)) {
      return {
        name: 'FullHDFilm',
        title: s.title,
        url: s.url
      };
    }

    return {
      name: 'FullHDFilm',
      title: `${s.title} [Harici Oynatıcı]`,
      externalUrl: s.url
    };
  });

  return { streams };
});

module.exports = builder.getInterface();
module.exports._private = {
  cleanTitle,
  findBestMatch,
  getTitleScore
};
