const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.fullhdfilmizlesene.nz';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': BASE_URL + '/'
};

function rot13(str) {
  return (str + '').replace(/[a-z]/gi, function(s) {
    return String.fromCharCode(s.charCodeAt(0) + (s.toLowerCase() < 'n' ? 13 : -13));
  });
}

function decodeSource(str) {
  try {
    const rotated = rot13(str);
    return Buffer.from(rotated, 'base64').toString('utf-8');
  } catch (e) {
    return null;
  }
}

/**
 * Searches the website for movies.
 * @param {string} query 
 * @returns {Promise<Array>} List of movies
 */
async function searchMovies(query) {
  try {
    const searchUrl = `${BASE_URL}/arama/${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, { headers: HEADERS });
    const $ = cheerio.load(response.data);
    const results = [];

    $('.list .film').each((i, el) => {
      const titleLink = $(el).find('a.tt');
      const title = titleLink.text().trim();
      const href = titleLink.attr('href');
      
      const imgEl = $(el).find('picture img');
      const poster = imgEl.attr('data-src') || imgEl.attr('src');
      
      const imdb = $(el).find('.imdb').text().trim();
      const year = $(el).find('.film-yil').text().trim();

      if (href) {
        results.push({
          title,
          url: href,
          poster: poster ? (poster.startsWith('http') ? poster : BASE_URL + poster) : '',
          imdb: imdb || 'N/A',
          year: year || 'N/A'
        });
      }
    });

    return results;
  } catch (error) {
    console.error('Error searching movies:', error.message);
    return [];
  }
}

function decryptRapidvid(e) {
  try {
    const reversed = e.split("").reverse().join("");
    const t = Buffer.from(reversed, 'base64').toString('utf-8');
    let o = "";
    for (let i = 0; i < t.length; i++) {
      const r = "K9L"[i % 3];
      const n = t.charCodeAt(i) - (r.charCodeAt(0) % 5 + 1);
      o += String.fromCharCode(n);
    }
    return Buffer.from(o, 'base64').toString('utf-8');
  } catch (err) {
    console.error('Error decrypting rapidvid:', err.message);
    return null;
  }
}

async function resolveRapidvidUrl(url) {
  try {
    const response = await axios.get(url, { headers: HEADERS });
    const html = response.data;
    const avMatch = html.match(/av\(\s*['"`](.*?)['"`]\s*\)/);
    if (avMatch && avMatch[1]) {
      const decrypted = decryptRapidvid(avMatch[1]);
      if (decrypted) {
        return decrypted;
      }
    }
  } catch (error) {
    console.error('Error resolving rapidvid url:', url, error.message);
  }
  return url;
}

/**
 * Fetches streams for a specific movie page.
 * @param {string} movieUrl 
 * @returns {Promise<Array>} List of streams
 */
async function getStreams(movieUrl) {
  try {
    const response = await axios.get(movieUrl, { headers: HEADERS });
    const $ = cheerio.load(response.data);
    const htmlContent = response.data;
    
    // Find var scx = ... in script tags
    const scxMatch = htmlContent.match(/var\s+scx\s*=\s*({.*?});/);
    if (!scxMatch) {
      return [];
    }

    const scxObj = JSON.parse(scxMatch[1]);
    const streams = [];

    for (const key in scxObj) {
      const source = scxObj[key];
      const name = source.tt ? Buffer.from(source.tt, 'base64').toString('utf-8') : key;
      const order = source.order || 0;

      // Extract Subtitles (t) and Dubbed (p) sources
      const subtitleSources = source.sx?.t || [];
      const dubbedSources = source.sx?.p || [];

      // Process subtitled
      subtitleSources.forEach((obfuscatedUrl, idx) => {
        if (obfuscatedUrl) {
          const decryptedUrl = decodeSource(obfuscatedUrl);
          if (decryptedUrl) {
            streams.push({
              title: `${name} [Altyazılı] [Part ${idx + 1}]`,
              url: decryptedUrl,
              type: 'subtitle',
              order
            });
          }
        }
      });

      // Process dubbed
      dubbedSources.forEach((obfuscatedUrl, idx) => {
        if (obfuscatedUrl) {
          const decryptedUrl = decodeSource(obfuscatedUrl);
          if (decryptedUrl) {
            streams.push({
              title: `${name} [Dublaj] [Part ${idx + 1}]`,
              url: decryptedUrl,
              type: 'dubbed',
              order
            });
          }
        }
      });
    }

    // Resolve rapidvid embeds to direct urls in parallel
    const resolvedStreams = await Promise.all(
      streams.map(async (s) => {
        if (s.url.includes('rapidvid.net')) {
          const directUrl = await resolveRapidvidUrl(s.url);
          return { ...s, url: directUrl };
        }
        return s;
      })
    );

    // Sort by order
    return resolvedStreams.sort((a, b) => a.order - b.order);
  } catch (error) {
    console.error('Error getting streams:', error.message);
    return [];
  }
}

module.exports = {
  searchMovies,
  getStreams,
  decodeSource,
  rot13,
  decryptRapidvid,
  resolveRapidvidUrl
};
