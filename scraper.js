const axios = require('axios');
const cheerio = require('cheerio');
const { makeProxyUrl } = require('./proxy');

const BASE_URL = 'https://www.fullhdfilmizlesene.nz';
const REQUEST_TIMEOUT_MS = 20000;
const STREAM_PROBE_TIMEOUT_MS = 8000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': BASE_URL + '/'
};

const STREAM_HEADERS = {
  ...HEADERS,
  'Accept': '*/*'
};

const DIRECT_VIDEO_EXTENSIONS = ['.m3u8', '.mp4', '.mkv', '.avi', '.mov', '.webm'];
const DIRECT_STREAM_HOSTS = [
  'picogallery.org',
  'picturebox.cloud',
  'imagehub.pics',
  'vphotos.org',
  'rupertes.ga'
];

function absoluteUrl(url, base = BASE_URL) {
  if (!url) return '';
  try {
    return new URL(url, base).href;
  } catch (error) {
    return url;
  }
}

function uniqBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isLikelyDirectStreamUrl(url = '') {
  const lower = url.toLowerCase();
  if (DIRECT_VIDEO_EXTENSIONS.some((ext) => lower.includes(ext))) return true;
  if (['master.txt', 'playlist.txt', 'index.txt'].some((pattern) => lower.includes(pattern))) return true;
  if (/content[_-]?type=video|mime=video|type=video/.test(lower)) return true;
  if (/\/(?:embed|player|watch|video)(?:\/|\?|$)|\/iframe(?:\/|\?|$)/.test(lower)) return false;

  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return DIRECT_STREAM_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch (error) {
    return false;
  }
}

function isPlayableContentType(contentType = '') {
  const lower = contentType.toLowerCase();
  return lower.includes('mpegurl') ||
    lower.includes('application/vnd.apple.mpegurl') ||
    lower.includes('video/') ||
    lower.includes('application/octet-stream');
}

async function probeDirectStream(url) {
  if (!url) return false;
  if (isLikelyDirectStreamUrl(url)) return true;

  try {
    const response = await axios.get(url, {
      headers: STREAM_HEADERS,
      timeout: STREAM_PROBE_TIMEOUT_MS,
      maxRedirects: 5,
      responseType: 'stream',
      validateStatus: (status) => status >= 200 && status < 400
    });

    response.data.destroy();
    return isPlayableContentType(response.headers['content-type']);
  } catch (error) {
    return false;
  }
}

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

function normalizeSourceList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  if (typeof value === 'object') return Object.values(value).flatMap(normalizeSourceList);
  return [];
}

/**
 * Searches the website for movies.
 * @param {string} query 
 * @returns {Promise<Array>} List of movies
 */
async function searchMovies(query) {
  try {
    const searchUrl = `${BASE_URL}/arama/${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, { headers: HEADERS, timeout: REQUEST_TIMEOUT_MS });
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
          url: absoluteUrl(href),
          poster: absoluteUrl(poster),
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

async function searchMoviesMany(queries) {
  const allResults = [];
  const uniqueQueries = [...new Set(queries.map((query) => String(query || '').trim()).filter(Boolean))];

  for (const query of uniqueQueries) {
    const results = await searchMovies(query);
    results.forEach((result) => allResults.push({ ...result, query }));
  }

  return uniqBy(allResults, (result) => result.url);
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
    const response = await axios.get(url, { headers: HEADERS, timeout: REQUEST_TIMEOUT_MS });
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

function unescapeJsString(str) {
  try {
    return Function(`return "${str.replace(/"/g, '\\"')}"`)();
  } catch (error) {
    return str;
  }
}

function extractPackedEvalCalls(html) {
  const calls = [];
  let idx = -1;

  while ((idx = html.indexOf('eval(function(p,a,c,k,e', idx + 1)) >= 0) {
    const start = idx + 4;
    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let i = start; i < html.length; i++) {
      const ch = html[i];

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) {
          calls.push(html.slice(start + 1, i));
          idx = i;
          break;
        }
      }
    }
  }

  return calls;
}

function unpackPackedScripts(html, depth = 0) {
  if (depth > 3) return [];

  const unpacked = [];
  const calls = extractPackedEvalCalls(html);

  for (const call of calls) {
    try {
      const source = String(eval(`(${call})`));
      unpacked.push(source, ...unpackPackedScripts(source, depth + 1));
    } catch (error) {
      // Ignore scripts that are not compatible with the Dean Edwards packer shape.
    }
  }

  return unpacked;
}

function extractUrlsFromText(text) {
  const urls = [];
  const plainUrlRegex = /https?:\/\/[^\s"'<>\\)]+/gi;
  const fileRegex = /(?:file|src)\s*[:=]\s*['"]([^'"]+)['"]/gi;

  for (const match of text.matchAll(plainUrlRegex)) {
    urls.push(match[0]);
  }

  for (const match of text.matchAll(fileRegex)) {
    urls.push(unescapeJsString(match[1]));
  }

  return urls
    .map((candidate) => candidate.replace(/&amp;/g, '&'))
    .filter((candidate) => /^https?:\/\//i.test(candidate));
}

function extractVidmoxyUrl(html) {
  const srMatch = html.match(/var\s+sr\s*=\s*["']([^"']+)["']/);
  const subMatch = html.match(/var\s+sub\s*=\s*["']([^"']*)["']/);
  const sourcesMatch = html.match(/jwSetup\.sources\s*=\s*(\[[\s\S]*?\]);/);

  if (!srMatch || !sourcesMatch) return null;

  try {
    const sr = unescapeJsString(srMatch[1]);
    const sub = subMatch ? subMatch[1] : '';
    const sources = Function(`return ${sourcesMatch[1]}`)();
    const sourceUrl = sources?.[0]?.file;
    if (!sourceUrl) return null;

    const parsed = new URL(sourceUrl);
    const hostPrefix = sub.length > 3 ? sub.substring(0, 1) : '';
    return `${parsed.protocol}//${hostPrefix}${sr}${parsed.pathname}`;
  } catch (error) {
    return null;
  }
}

function extractTrPlayerUrl(html, embedUrl) {
  const videoMatch = html.match(/var\s+video\s*=\s*({[\s\S]*?});/);
  if (!videoMatch) return null;

  try {
    const video = JSON.parse(videoMatch[1]);
    if (!video.uid || !video.md5 || !video.id) return null;

    const manifestPath = `/m3u8/${video.uid}/${video.md5}/master.txt?s=1&id=${video.id}&cache=${video.status || 1}`;
    return makeProxyUrl(absoluteUrl(manifestPath, embedUrl), embedUrl);
  } catch (error) {
    return null;
  }
}

async function resolveEmbedUrl(url) {
  if (!url) return url;
  const shouldFetchEmbedFirst = /watch\.trplayer\.com/i.test(url);
  if (!shouldFetchEmbedFirst && await probeDirectStream(url)) return url;

  try {
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400
    });

    const html = response.data;
    const finalUrl = response.request?.res?.responseUrl || url;

    if (/watch\.trplayer\.com/i.test(finalUrl)) {
      const trPlayerUrl = extractTrPlayerUrl(html, finalUrl);
      if (trPlayerUrl) return trPlayerUrl;
    }

    const unpackedScripts = unpackPackedScripts(html);
    const candidates = [
      ...extractUrlsFromText(html),
      ...unpackedScripts.flatMap(extractUrlsFromText)
    ];

    const vidmoxyUrl = extractVidmoxyUrl(`${html}\n${unpackedScripts.join('\n')}`);
    if (vidmoxyUrl) candidates.unshift(vidmoxyUrl);

    for (const candidate of uniqBy(candidates.map((candidateUrl) => absoluteUrl(candidateUrl, url)), Boolean)) {
      if (candidate === url) continue;
      if (await probeDirectStream(candidate)) {
        return candidate;
      }
    }
  } catch (error) {
    console.error('Error resolving embed url:', url, error.message);
  }

  return null;
}

/**
 * Fetches streams for a specific movie page.
 * @param {string} movieUrl 
 * @returns {Promise<Array>} List of streams
 */
async function getStreams(movieUrl) {
  try {
    const response = await axios.get(movieUrl, { headers: HEADERS, timeout: REQUEST_TIMEOUT_MS });
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
      const subtitleSources = normalizeSourceList(source.sx?.t);
      const dubbedSources = normalizeSourceList(source.sx?.p);

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

    // Resolve embeds to direct HLS/video urls where possible.
    const resolvedStreams = await Promise.all(
      streams.map(async (s) => {
        if (s.url.includes('rapidvid.net')) {
          const directUrl = await resolveRapidvidUrl(s.url);
          return { ...s, url: directUrl };
        }

        const directUrl = await resolveEmbedUrl(s.url);
        return directUrl ? { ...s, url: directUrl } : null;
      })
    );

    // Sort by order
    return uniqBy(resolvedStreams.filter(Boolean), (stream) => stream.url).sort((a, b) => a.order - b.order);
  } catch (error) {
    console.error('Error getting streams:', error.message);
    return [];
  }
}

module.exports = {
  searchMovies,
  searchMoviesMany,
  getStreams,
  decodeSource,
  rot13,
  decryptRapidvid,
  resolveRapidvidUrl,
  resolveEmbedUrl,
  probeDirectStream,
  isLikelyDirectStreamUrl,
  extractTrPlayerUrl
};
