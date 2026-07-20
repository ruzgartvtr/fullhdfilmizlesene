const axios = require('axios');
const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');
const fullHd = require('./scraper');
const { makeProxyUrl } = require('./proxy');

const REQUEST_TIMEOUT_MS = 12000;
const EMBED_TIMEOUT_MS = 8000;
const JETFILM_BASE = 'https://jetfilmizle.now';
const DIZIYOU_BASE = 'https://www.diziyou.one';
const DIZIFILMIZLE_BASE = 'https://dizifilmizle.to';
const DDIZI_BASE = 'https://www.ddizi.im';
const TVDIZILER_BASE = 'https://tvdiziler.tv';
const YOUTUBE_BASE = 'https://www.youtube.com';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
};

function absoluteUrl(url, base) {
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

function cleanText(text = '') {
  return String(text).replace(/\s+/g, ' ').trim();
}

function parseYear(text = '') {
  return String(text).match(/\b(19|20)\d{2}\b/)?.[0] || 'N/A';
}

function parseYearFromUrl(url = '') {
  const years = String(url).match(/\b(?:19|20)\d{2}\b/g) || [];
  return years.at(-1) || 'N/A';
}

function parseImdb(text = '') {
  return String(text).match(/\b\d(?:[.,]\d)?\b/)?.[0]?.replace(',', '.') || 'N/A';
}

function slugify(text = '') {
  return cleanText(text)
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractYouTubeId(url = '') {
  const text = String(url || '');
  return text.match(/(?:youtube\.com\/embed\/|youtube\.com\/watch\?v=|youtu\.be\/|youtube\.php\?id=)([A-Za-z0-9_-]{6,})/)?.[1] || null;
}

function htmlDecode(text = '') {
  return String(text)
    .replace(/\\u0026/g, '&')
    .replace(/\\\"/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractUrlsFromText(text = '') {
  const urls = [];
  for (const match of String(text).matchAll(/https?:\/\/[^\s"'<>\\)]+/gi)) urls.push(match[0].replace(/&amp;/g, '&'));
  for (const match of String(text).matchAll(/(?:file|src|url|source)\s*[:=]\s*['"]([^'"]+)['"]/gi)) urls.push(match[1].replace(/&amp;/g, '&'));
  return [...new Set(urls)];
}

function titleFromSlug(slug = '') {
  return cleanText(slug
    .replace(/-hd\d*$/i, '')
    .replace(/-\d+$/i, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toLocaleUpperCase('tr-TR')));
}

async function searchQueries(queries, searchFn, perQueryTimeoutMs = REQUEST_TIMEOUT_MS) {
  const uniqueQueries = [...new Set(queries.map((query) => String(query || '').trim()).filter(Boolean))];
  const settled = await Promise.all(uniqueQueries.map(async (query) => {
    try {
      return await Promise.race([
        searchFn(query),
        new Promise((resolve) => setTimeout(() => resolve([]), perQueryTimeoutMs))
      ]);
    } catch (error) {
      return [];
    }
  }));
  return uniqBy(settled.flat(), (result) => result.url);
}

async function fetchHtml(url, options = {}) {
  const response = await axios.get(url, {
    timeout: options.timeout || REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
    headers: {
      ...DEFAULT_HEADERS,
      Referer: options.referer || new URL(url).origin + '/',
      ...(options.headers || {})
    },
    validateStatus: (status) => status >= 200 && status < 400
  });

  return {
    html: String(response.data),
    finalUrl: response.request?.res?.responseUrl || url,
    headers: response.headers
  };
}

function isMoviePageUrl(url) {
  if (!url) return false;
  try {
    const pathname = new URL(url).pathname;
    if (/\/film\/?$/i.test(pathname)) return false;
    return /(?:film-izle|\/film\/[^/]+\/?|tt\d+)/i.test(pathname);
  } catch (error) {
    if (/\/film\/?$/i.test(url)) return false;
    return /(?:film-izle|\/film\/[^/]+\/?|tt\d+)/i.test(url.split('?')[0]);
  }
}

function parseFilmmoduResultPage(html, url, query) {
  const $ = cheerio.load(html);
  const title = cleanText($('meta[property="og:title"]').attr('content') || $('title').text())
    .replace(/\s+izle\s*\|.*$/i, '')
    .replace(/\s+-\s+/g, ' - ');
  const poster = $('meta[property="og:image"]').attr('content') || '';
  const imdb = parseImdb($('p:contains("IMDB")').first().text());
  const year = parseYear($('p:contains("Yapım")').first().text() || $('title').text());

  if (!title || !isMoviePageUrl(url)) return null;

  return {
    source: 'Filmmodu',
    title,
    url,
    poster,
    imdb,
    year,
    query
  };
}

async function searchFilmmodu(query) {
  const searchUrl = `https://www.filmmodu.one/film-ara?term=${encodeURIComponent(query)}`;
  try {
    const { html, finalUrl } = await fetchHtml(searchUrl, { referer: 'https://www.filmmodu.one/' });
    const directResult = parseFilmmoduResultPage(html, finalUrl, query);
    if (directResult) return [directResult];

    const $ = cheerio.load(html);
    const results = [];
    $('a').each((_, el) => {
      const href = absoluteUrl($(el).attr('href'), finalUrl);
      const title = cleanText($(el).text());
      if (!href || !title || !isMoviePageUrl(href)) return;
      if (/fragman|giriş|kayıt|iletişim|film izle$/i.test(title)) return;
      if (/filmler|film türleri|film yılları|altyazılı filmler|dublaj filmler|4k$/i.test(title)) return;

      const containerText = cleanText($(el).closest('.movie, .film, .item, .col-md-2, .col-lg-2, li, article, div').text());
      results.push({
        source: 'Filmmodu',
        title,
        url: href,
        poster: absoluteUrl($(el).find('img').attr('src') || $(el).closest('div').find('img').first().attr('src'), finalUrl),
        imdb: parseImdb(containerText),
        year: parseYear(containerText),
        query
      });
    });

    return uniqBy(results, (result) => result.url).slice(0, 12);
  } catch (error) {
    console.error(`Filmmodu search failed for "${query}":`, error.message);
    return [];
  }
}

function getFilmmoduVariantUrls($, pageUrl) {
  const urls = [];
  $('.alternates a, a.btn').each((_, el) => {
    const href = absoluteUrl($(el).attr('href'), pageUrl);
    const label = cleanText($(el).text()).toLowerCase();
    if (!href || label.includes('fragman')) return;
    if (/dublaj|altyaz/i.test(label) || /dublaj|altyaz/i.test(href)) urls.push(href);
  });
  if (/dublaj|altyaz/i.test(pageUrl)) urls.unshift(pageUrl);
  return uniqBy(urls, Boolean);
}

async function getFilmmoduStreams(movieUrl) {
  const streams = [];
  try {
    const first = await fetchHtml(movieUrl, { referer: 'https://www.filmmodu.one/' });
    const $ = cheerio.load(first.html);
    const variants = getFilmmoduVariantUrls($, first.finalUrl);

    for (const variantUrl of variants) {
      const { html } = variantUrl === first.finalUrl ? first : await fetchHtml(variantUrl, { referer: first.finalUrl });
      const videoId = html.match(/var\s+videoId\s*=\s*['"]([^'"]+)/)?.[1];
      const videoType = html.match(/var\s+videoType\s*=\s*['"]([^'"]*)/)?.[1];
      if (!videoId || !videoType) continue;

      const apiUrl = `https://www.filmmodu.one/get-source?movie_id=${encodeURIComponent(videoId)}&type=${encodeURIComponent(videoType)}`;
      const response = await axios.get(apiUrl, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          ...DEFAULT_HEADERS,
          Accept: 'application/json,text/javascript,*/*',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: variantUrl
        }
      });

      const lang = videoType === 'tr' ? 'Dublaj' : 'Altyazılı';
      const subtitle = response.data?.subtitle ? absoluteUrl(response.data.subtitle, 'https://www.filmmodu.one') : null;
      for (const source of response.data?.sources || []) {
        if (!source.src) continue;
        streams.push({
          source: 'Filmmodu',
          title: `Filmmodu [${lang}] [${source.label || source.res || 'HD'}]`,
          url: source.src,
          type: videoType === 'tr' ? 'dubbed' : 'subtitle',
          quality: Number(source.res) || 0,
          subtitles: subtitle ? [{ lang: 'tur', url: subtitle }] : undefined
        });
      }
    }
  } catch (error) {
    console.error('Filmmodu streams failed:', error.message);
  }

  return uniqBy(streams, (stream) => `${stream.url}:${stream.title}`)
    .sort((a, b) => (b.quality || 0) - (a.quality || 0));
}

async function searchHdfilmcehennemi(query) {
  const searchUrl = `https://www.hdfilmcehennemi.now/?s=${encodeURIComponent(query)}`;
  try {
    const directSlugResults = !/^tt\d+$/i.test(String(query)) ? await probeHdfilmcehennemiMovieSlugs(query, 2) : [];
    if (directSlugResults.length > 0) return directSlugResults;

    const { html, finalUrl } = await fetchHtml(searchUrl, { referer: 'https://www.hdfilmcehennemi.now/' });
    const $ = cheerio.load(html);
    const results = [];

    $('a[href*="/film/"]').each((_, el) => {
      const href = absoluteUrl($(el).attr('href'), finalUrl);
      const title = cleanText($(el).text());
      if (!href || !title || title.length < 2 || /^film(?:ler)?$/i.test(title)) return;
      if (!isMoviePageUrl(href)) return;

      const containerText = cleanText($(el).closest('article, .item, .result-item, .data, li, div').text());
      results.push({
        source: 'HDFilmCehennemi',
        title,
        url: href,
        poster: absoluteUrl($(el).find('img').attr('src') || $(el).closest('article, div').find('img').first().attr('src'), finalUrl),
        imdb: parseImdb(containerText),
        year: parseYearFromUrl(href) !== 'N/A' ? parseYearFromUrl(href) : parseYear(containerText || title),
        query
      });
    });

    if (results.length === 0) {
      results.push(...await probeHdfilmcehennemiMovieSlugs(query));
    }
    return uniqBy(results, (result) => result.url).slice(0, 16);
  } catch (error) {
    console.error(`HDFilmCehennemi search failed for "${query}":`, error.message);
    return probeHdfilmcehennemiMovieSlugs(query);
  }
}

async function searchHdfilmcehennemiMany(queries) {
  const uniqueQueries = [...new Set(queries.map((query) => cleanText(query)).filter(Boolean))];
  const strongQueries = uniqueQueries.filter((query) => !/^tt\d+$/i.test(query) && /\b(?:19|20)\d{2}\b/.test(query));

  for (const query of strongQueries.slice(0, 2)) {
    const result = await probeHdfilmcehennemiMovieSlugs(query, 3);
    if (result.length > 0) return result;
  }

  return searchQueries(uniqueQueries, searchHdfilmcehennemi, 3500);
}

function parseHdfMoviePageResult(html, url, query) {
  const $ = cheerio.load(html);
  const title = cleanText(
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text() ||
    $('title').text()
  )
    .replace(/\s+(?:izle|full izle|hd izle).*$/i, '')
    .replace(/\s+-\s+HDFilmCehennemi.*$/i, '')
    .trim();

  if (!title || !/\/film\//i.test(url)) return null;
  return {
    source: 'HDFilmCehennemi',
    title,
    url,
    poster: absoluteUrl($('meta[property="og:image"]').attr('content') || $('img').first().attr('src'), url),
    imdb: parseImdb($('body').text()),
    year: parseYearFromUrl(url) !== 'N/A' ? parseYearFromUrl(url) : parseYear($('body').text() || title),
    query
  };
}

async function probeHdfilmcehennemiMovieSlugs(query, maxCandidates = 5) {
  if (!query || /^tt\d+$/i.test(query) || /^series\//i.test(query)) return [];
  const slug = slugify(query).replace(/(?:^|-)(?:izle|full|hd)(?:-|$)/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length < 3) return [];

  const candidates = [
    `${slug}-izle`,
    `${slug}-izle-2`,
    `${slug}-izle-1`,
    `${slug}-hd-izle`,
    `${slug}-full-izle`
  ];

  const results = [];
  for (const candidate of [...new Set(candidates)].slice(0, maxCandidates)) {
    const url = `https://www.hdfilmcehennemi.now/film/${candidate}/`;
    try {
      const { html, finalUrl } = await fetchHtml(url, { referer: 'https://www.hdfilmcehennemi.now/', timeout: 6000 });
      if (!/get_video_url|data-player-name|iframe|FastPlay/i.test(html)) continue;
      const result = parseHdfMoviePageResult(html, finalUrl, query);
      if (result) results.push(result);
    } catch (error) {
      // Candidate URL did not exist; keep trying nearby slug forms.
    }
  }

  return uniqBy(results, (result) => result.url);
}

function extractFastPlayManifest(html, embedUrl) {
  const streamUrl = html.match(/const\s+streamUrl\s*=\s*["']([^"']+)/)?.[1] ||
    html.match(/file\s*:\s*["']([^"']+)/)?.[1];
  if (!streamUrl) return null;
  return absoluteUrl(streamUrl, embedUrl);
}

function extractSetPlayManifest(html) {
  const configMatch = html.match(/FirePlayer\([^,]+,\s*({[\s\S]*?})\s*,\s*false\)/);
  if (!configMatch) return null;
  try {
    const config = Function(`return ${configMatch[1]}`)();
    const hosts = config.hostList?.[config.videoServer] || [];
    const path = config.videoUrl;
    if (!hosts.length || !path) return null;
    return `https://${hosts[0]}${path}`;
  } catch (error) {
    return null;
  }
}

async function isUsableHlsManifest(manifestUrl, referer) {
  try {
    const response = await axios.get(manifestUrl, {
      timeout: 6000,
      maxRedirects: 5,
      headers: {
        ...DEFAULT_HEADERS,
        Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*',
        Referer: referer
      },
      validateStatus: (status) => status >= 200 && status < 300
    });
    return String(response.data || '').trimStart().startsWith('#EXTM3U');
  } catch (error) {
    return false;
  }
}

async function resolveHdfEmbed(embedUrl, pageUrl) {
  if (/fastplay\./i.test(embedUrl)) {
    try {
      const parsed = new URL(embedUrl);
      const videoId = parsed.pathname.match(/\/video\/([^/?#]+)/)?.[1];
      if (videoId) {
        const manifestUrl = `${parsed.origin}/manifests/${videoId}/master.txt`;
        return makeProxyUrl(manifestUrl, embedUrl);
      }
    } catch (error) {
      // Fall through to the slower HTML resolver.
    }
  }

  try {
    const { html, finalUrl } = await fetchHtml(embedUrl, { referer: pageUrl, timeout: EMBED_TIMEOUT_MS });
    const manifestUrl = finalUrl.includes('fastplay.')
      ? extractFastPlayManifest(html, finalUrl)
      : extractSetPlayManifest(html);
    if (manifestUrl) {
      return await isUsableHlsManifest(manifestUrl, finalUrl) ? makeProxyUrl(manifestUrl, finalUrl) : null;
    }

    const resolved = await fullHd.resolveEmbedUrl(finalUrl);
    return resolved !== finalUrl ? resolved : null;
  } catch (error) {
    console.error('HDFilmCehennemi embed resolve failed:', embedUrl, error.message);
    return null;
  }
}

function detectHdfLanguage($, optionPartKey = '', groupKey = '') {
  const key = String(optionPartKey || '').toLocaleLowerCase('tr-TR');
  const group = String(groupKey || '').toLocaleLowerCase('tr-TR');
  if (key.includes('dublaj')) return 'Dublaj';
  if (key.includes('altyazi') || key.includes('altyaz')) return 'Altyazılı';
  if (group.includes('dublaj')) return 'Dublaj';
  if (group.includes('altyazi') || group.includes('altyaz')) return 'Altyazılı';
  if (group.includes('yerli')) return 'Yerli';

  const pageLanguage = cleanText($('.dilx, .hplayer, .control .player').first().text()).toLocaleLowerCase('tr-TR');
  if (pageLanguage.includes('dublaj')) return 'Dublaj';
  if (pageLanguage.includes('altyaz')) return 'Altyazılı';
  if (pageLanguage.includes('yerli')) return 'Yerli';
  return 'Yerli/Dil';
}

async function getHdfilmcehennemiStreams(movieUrl) {
  const streams = [];
  try {
    const { html, finalUrl } = await fetchHtml(movieUrl, { referer: 'https://www.hdfilmcehennemi.now/', timeout: 18000 });
    const $ = cheerio.load(html);
    const nonce = html.match(/window\.videoAjax\s*=\s*{[\s\S]*?nonce:\s*['"]([^'"]+)/)?.[1];
    if (!nonce) return [];

    const options = [];
    $('.options2[data-post-id][data-player-name], .options[data-post-id][data-player-name]').each((_, el) => {
      const playerName = $(el).attr('data-player-name');
      if (!playerName) return;
      options.push({
        postId: $(el).attr('data-post-id'),
        playerName,
        partKey: $(el).attr('data-part-key'),
        groupKey: $(el).closest('[data-player-group], .hrknHangiPart').attr('data-player-group') || '',
        title: $(el).attr('title') || cleanText($(el).text())
      });
    });

    const fastPlayOptions = options.filter((option) => /fastplay/i.test(option.playerName));
    const optionsToResolve = fastPlayOptions.length > 0 ? fastPlayOptions : options;

    const resolvedOptions = await Promise.all(optionsToResolve.map(async (option) => {
      if (!option.postId || !option.playerName) return null;
      try {
        const response = await axios.post(
          'https://www.hdfilmcehennemi.now/wp-admin/admin-ajax.php',
          new URLSearchParams({
            action: 'get_video_url',
            nonce,
            post_id: option.postId,
            player_name: option.playerName,
            part_key: option.partKey || ''
          }).toString(),
          {
            timeout: EMBED_TIMEOUT_MS,
            headers: {
              ...DEFAULT_HEADERS,
              Referer: finalUrl,
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest'
            }
          }
        );

        const embedUrl = response.data?.data?.url;
        if (!embedUrl) return null;
        const playableUrl = await resolveHdfEmbed(embedUrl, finalUrl);
        if (!playableUrl) return null;

        const lang = detectHdfLanguage($, option.partKey, option.groupKey);
        return {
          source: 'HDFilmCehennemi',
          title: `HDFilmCehennemi [${lang}] [${option.title || option.playerName}]`,
          url: playableUrl,
          type: lang === 'Altyazılı' ? 'subtitle' : 'dubbed',
          quality: option.playerName === 'FastPlay' ? 1080 : 720
        };
      } catch (error) {
        console.error('HDFilmCehennemi option failed:', option.playerName, option.partKey, error.message);
        return null;
      }
    }));

    streams.push(...resolvedOptions.filter(Boolean));
  } catch (error) {
    console.error('HDFilmCehennemi streams failed:', error.message);
  }

  return uniqBy(streams, (stream) => stream.url);
}

async function searchWebteIzle(query) {
  const searchUrl = `https://webteizle.info/?s=${encodeURIComponent(query)}`;
  try {
    const { html, finalUrl } = await fetchHtml(searchUrl, { referer: 'https://webteizle.info/' });
    const $ = cheerio.load(html);
    const results = [];
    $('a[href*="/izle/"]').each((_, el) => {
      const href = absoluteUrl($(el).attr('href'), finalUrl);
      const title = cleanText($(el).text());
      if (!href || !title) return;
      const containerText = cleanText($(el).closest('article, .item, li, div').text());
      results.push({
        source: 'WebteIzle',
        title,
        url: href,
        poster: absoluteUrl($(el).find('img').attr('src') || $(el).closest('div').find('img').first().attr('src'), finalUrl),
        imdb: parseImdb(containerText),
        year: parseYear(containerText),
        query
      });
    });
    return uniqBy(results, (result) => result.url).slice(0, 12);
  } catch (error) {
    console.error(`WebteIzle search failed for "${query}":`, error.response?.status === 403 ? 'Cloudflare blocked' : error.message);
    return [];
  }
}

async function getWebteIzleStreams(movieUrl) {
  try {
    const { html, finalUrl } = await fetchHtml(movieUrl, { referer: 'https://webteizle.info/' });
    const resolved = await fullHd.resolveEmbedUrl(finalUrl);
    if (resolved && resolved !== finalUrl) {
      return [{
        source: 'WebteIzle',
        title: 'WebteIzle [HD]',
        url: resolved,
        quality: 720
      }];
    }
    void html;
  } catch (error) {
    console.error('WebteIzle streams failed:', error.response?.status === 403 ? 'Cloudflare blocked' : error.message);
  }
  return [];
}

async function searchJetFilm(query, contentType = 'movie') {
  const searchUrl = `${JETFILM_BASE}/arama-json?q=${encodeURIComponent(query)}`;
  try {
    const response = await axios.get(searchUrl, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        ...DEFAULT_HEADERS,
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${JETFILM_BASE}/`
      }
    });

    const results = Array.isArray(response.data?.results) ? response.data.results : [];
    const expectedType = contentType === 'series' ? 'dizi' : 'film';
    return results
      .filter((result) => result.type === expectedType && result.url)
      .map((result) => ({
        source: 'JetFilm',
        title: result.title || result.original_title,
        originalTitle: result.original_title || '',
        url: absoluteUrl(result.url, JETFILM_BASE),
        poster: absoluteUrl(result.poster, JETFILM_BASE),
        imdb: result.rating || 'N/A',
        year: result.year || 'N/A',
        imdbId: result.imdb_id || '',
        query
      }))
      .filter((result) => result.title && result.url)
      .slice(0, 12);
  } catch (error) {
    console.error(`JetFilm JSON search failed for "${query}":`, error.message);
  }

  try {
    const { html, finalUrl } = await fetchHtml(`${JETFILM_BASE}/arama?q=${encodeURIComponent(query)}`, {
      referer: `${JETFILM_BASE}/`,
      timeout: REQUEST_TIMEOUT_MS
    });
    const $ = cheerio.load(html);
    const results = [];
    const pathPart = contentType === 'series' ? '/dizi/' : '/film/';
    $('a').each((_, el) => {
      const href = absoluteUrl($(el).attr('href'), finalUrl);
      const text = cleanText($(el).text());
      const containerText = cleanText($(el).closest('.film-card, .card, article, li, div').text());
      const title = text.replace(/\b(19|20)\d{2}\b.*$/, '').trim() || text;
      if (!href || !title || !href.includes(pathPart)) return;
      results.push({
        source: 'JetFilm',
        title,
        url: href,
        poster: absoluteUrl($(el).find('img').attr('src') || $(el).closest('div').find('img').first().attr('src'), finalUrl),
        imdb: parseImdb(containerText),
        year: parseYear(containerText),
        query
      });
    });
    return uniqBy(results, (result) => result.url).slice(0, 12);
  } catch (error) {
    console.error(`JetFilm HTML search failed for "${query}":`, error.message);
    return [];
  }
}

function getJetFilmSources($) {
  const sources = [];
  $('.player-source-btn').each((_, el) => {
    const button = $(el);
    const type = button.attr('data-player-type');
    const index = button.attr('data-source-index');
    if (!type || index === undefined) return;
    sources.push({
      type,
      index,
      label: cleanText(button.text()) || `Kaynak ${Number(index) + 1}`
    });
  });
  return uniqBy(sources, (source) => `${source.type}:${source.index}`);
}

function getJetFilmEpisodeSource($, season, episode) {
  const exact = $(`.player-source-btn[data-season="${season}"][data-episode="${episode}"]`).first();
  if (!exact.length) return null;
  return {
    type: exact.attr('data-player-type'),
    index: exact.attr('data-source-index'),
    label: `S${season}E${episode}`
  };
}

function extractPlayerXStreams(html, embedUrl, sourceLabel, langLabel) {
  const streams = [];
  const fileRegex = /file\s*:\s*["']([^"']+)["'][\s\S]{0,80}?type\s*:\s*["']hls["']/gi;
  let match;
  while ((match = fileRegex.exec(html)) !== null) {
    const manifestUrl = absoluteUrl(match[1], embedUrl);
    streams.push({
      source: 'JetFilm',
      title: `JetFilm [${langLabel}] [${sourceLabel}]`,
      url: makeProxyUrl(manifestUrl, embedUrl),
      type: langLabel === 'Dublaj' ? 'dubbed' : 'subtitle',
      quality: /2160|4k/i.test(html) ? 2160 : 1080
    });
  }

  return streams;
}

async function resolvePlayerXEmbed(embedUrl, pageUrl, sourceLabel, langLabel) {
  try {
    const { html, finalUrl } = await fetchHtml(embedUrl, {
      referer: pageUrl,
      timeout: EMBED_TIMEOUT_MS,
      headers: { Accept: 'text/html,*/*' }
    });
    return extractPlayerXStreams(html, finalUrl, sourceLabel, langLabel);
  } catch (error) {
    console.error('JetFilm PlayerX resolve failed:', embedUrl, error.message);
    return [];
  }
}

function extractVideoParkStreams(html, embedUrl, sourceName, titlePrefix) {
  const configMatch = html.match(/var\s+_sd\s*=\s*({[\s\S]*?});/);
  if (!configMatch) return [];
  try {
    const config = JSON.parse(configMatch[1]);
    if (!config.stream_url) return [];
    const subtitles = Array.isArray(config.subtitles)
      ? config.subtitles
        .filter((subtitle) => subtitle.file)
        .map((subtitle) => ({
          lang: /ingilizce|english/i.test(subtitle.label) ? 'eng' : 'tur',
          url: absoluteUrl(subtitle.file, embedUrl)
        }))
      : undefined;
    return [{
      source: sourceName,
      title: `${sourceName} ${titlePrefix} [Videopark]`,
      url: makeProxyUrl(absoluteUrl(config.stream_url, embedUrl), embedUrl),
      quality: 1080,
      subtitles
    }];
  } catch (error) {
    return [];
  }
}

async function resolveVideoParkEmbed(embedUrl, pageUrl, sourceName, titlePrefix) {
  try {
    const { html, finalUrl } = await fetchHtml(embedUrl, {
      referer: pageUrl,
      timeout: EMBED_TIMEOUT_MS,
      headers: { Accept: 'text/html,*/*' }
    });
    return extractVideoParkStreams(html, finalUrl, sourceName, titlePrefix);
  } catch (error) {
    console.error(`${sourceName} Videopark resolve failed:`, error.message);
    return [];
  }
}

async function getJetFilmStreams(movieUrl) {
  const streams = [];
  try {
    const first = await fetchHtml(movieUrl, { referer: `${JETFILM_BASE}/` });
    const $ = cheerio.load(first.html);
    const filmId = $('input[name="film_id"]').attr('value') || first.html.match(/data-film-id=["'](\d+)/)?.[1];
    if (!filmId) return [];

    const sources = getJetFilmSources($).slice(0, 8);
    for (const source of sources) {
      try {
        const response = await axios.post(
          `${JETFILM_BASE}/jetplayer`,
          new URLSearchParams({
            film_id: filmId,
            source_index: source.index,
            player_type: source.type
          }).toString(),
          {
            timeout: EMBED_TIMEOUT_MS,
            headers: {
              ...DEFAULT_HEADERS,
              Accept: 'text/html,*/*',
              Origin: JETFILM_BASE,
              Referer: first.finalUrl,
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest'
            }
          }
        );

        const playerHtml = String(response.data);
        const player = cheerio.load(playerHtml);
        const embedUrl = absoluteUrl(player('iframe').attr('src'), first.finalUrl);
        if (!embedUrl) continue;

        const langLabel = source.type === 'dublaj' ? 'Dublaj' : source.type === 'altyazi' ? 'Altyazılı' : 'Dil+';
        if (/playerx\.info/i.test(embedUrl)) {
          streams.push(...await resolvePlayerXEmbed(embedUrl, first.finalUrl, source.label, langLabel));
          if (streams.length >= 1) break;
          continue;
        }

        const resolved = await fullHd.resolveEmbedUrl(embedUrl);
        if (!resolved || resolved === embedUrl) continue;
        streams.push({
          source: 'JetFilm',
          title: `JetFilm [${langLabel}] [${source.label}]`,
          url: resolved,
          type: langLabel === 'Dublaj' ? 'dubbed' : 'subtitle',
          quality: 720
        });
        if (streams.length >= 1) break;
      } catch (error) {
        console.error('JetFilm source failed:', source.type, source.index, error.message);
      }
    }
  } catch (error) {
    console.error('JetFilm streams failed:', error.message);
  }

  return uniqBy(streams, (stream) => stream.url)
    .sort((a, b) => (b.quality || 0) - (a.quality || 0));
}

async function getJetFilmEpisodeStreams(seriesUrl, season, episode) {
  const streams = [];
  try {
    const first = await fetchHtml(seriesUrl, { referer: `${JETFILM_BASE}/`, timeout: 18000 });
    const $ = cheerio.load(first.html);
    const filmId = $('input[name="film_id"]').attr('value') || first.html.match(/data-film-id=["'](\d+)/)?.[1];
    const source = getJetFilmEpisodeSource($, season, episode);
    if (!filmId || !source?.type || source.index === undefined) return [];

    const response = await axios.post(
      `${JETFILM_BASE}/jetplayer`,
      new URLSearchParams({
        film_id: filmId,
        source_index: source.index,
        player_type: source.type
      }).toString(),
      {
        timeout: EMBED_TIMEOUT_MS,
        headers: {
          ...DEFAULT_HEADERS,
          Accept: '*/*',
          Origin: JETFILM_BASE,
          Referer: first.finalUrl,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );

    const player = cheerio.load(String(response.data));
    const embedUrl = absoluteUrl(player('iframe').attr('src'), first.finalUrl);
    if (!embedUrl) return [];
    const langLabel = source.type === 'dublaj' ? 'Dublaj' : source.type === 'altyazi' ? 'Altyazılı' : 'Dil+';
    if (/playerx\.info/i.test(embedUrl)) {
      streams.push(...await resolvePlayerXEmbed(embedUrl, first.finalUrl, source.label, langLabel));
    } else if (/videopark\./i.test(embedUrl)) {
      streams.push(...await resolveVideoParkEmbed(embedUrl, first.finalUrl, 'JetFilm', `[${langLabel}] [S${season}E${episode}]`));
    } else {
      const resolved = await fullHd.resolveEmbedUrl(embedUrl);
      if (resolved && resolved !== embedUrl) {
        streams.push({
          source: 'JetFilm',
          title: `JetFilm [${langLabel}] [S${season}E${episode}]`,
          url: resolved,
          type: langLabel === 'Dublaj' ? 'dubbed' : 'subtitle',
          quality: 720
        });
      }
    }
  } catch (error) {
    console.error('JetFilm episode streams failed:', error.message);
  }

  return uniqBy(streams, (stream) => stream.url);
}

async function searchHdfilmcehennemiSeries(query) {
  const searchUrl = `https://www.hdfilmcehennemi.now/?s=${encodeURIComponent(query)}`;
  try {
    const { html, finalUrl } = await fetchHtml(searchUrl, { referer: 'https://www.hdfilmcehennemi.now/' });
    const $ = cheerio.load(html);
    const results = [];

    $('a[href*="/dizi/"]').each((_, el) => {
      const href = absoluteUrl($(el).attr('href'), finalUrl);
      const title = cleanText($(el).text());
      if (!href || !title || /^dizi(?:ler)?$/i.test(title)) return;
      const containerText = cleanText($(el).closest('article, .item, .result-item, .data, li, div').text());
      results.push({
        source: 'HDFilmCehennemi',
        title,
        url: href,
        poster: absoluteUrl($(el).find('img').attr('src') || $(el).closest('article, div').find('img').first().attr('src'), finalUrl),
        imdb: parseImdb(containerText),
        year: parseYear(containerText || title),
        query
      });
    });

    return uniqBy(results, (result) => result.url).slice(0, 12);
  } catch (error) {
    console.error(`HDFilmCehennemi series search failed for "${query}":`, error.message);
    return [];
  }
}

async function getHdfilmcehennemiEpisodeStreams(seriesUrl, season, episode) {
  try {
    const { html, finalUrl } = await fetchHtml(seriesUrl, { referer: 'https://www.hdfilmcehennemi.now/' });
    const $ = cheerio.load(html);
    let episodeUrl = '';
    $('a[href*="/bolum/"]').each((_, el) => {
      if (episodeUrl) return;
      const href = absoluteUrl($(el).attr('href'), finalUrl);
      const text = cleanText($(el).text());
      const haystack = `${href} ${text}`;
      const seasonMatches = new RegExp(`(?:^|[^0-9])${season}\\.?\\s*sezon`, 'i').test(haystack);
      const episodeMatches = new RegExp(`(?:^|[^0-9])${episode}\\.?\\s*b[öo]l[üu]m`, 'i').test(haystack);
      if (href && seasonMatches && episodeMatches) episodeUrl = href;
    });
    if (!episodeUrl) return [];
    const streams = await getHdfilmcehennemiStreams(episodeUrl);
    return streams.map((stream) => ({
      ...stream,
      title: stream.title.replace('HDFilmCehennemi ', `HDFilmCehennemi [S${season}E${episode}] `)
    }));
  } catch (error) {
    console.error('HDFilmCehennemi episode streams failed:', error.message);
    return [];
  }
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    return null;
  }
}

async function searchDiziFilmizleSeries(query) {
  try {
    const { html, finalUrl } = await fetchHtml(`${DIZIFILMIZLE_BASE}/?s=${encodeURIComponent(query)}`, {
      referer: `${DIZIFILMIZLE_BASE}/`
    });
    const $ = cheerio.load(html);
    const results = [];
    $('a[href*="/dizi/"]').each((_, el) => {
      const href = absoluteUrl($(el).attr('href'), finalUrl);
      const text = cleanText($(el).text());
      if (!href || /sezon|bölüm|bolum/i.test(href)) return;
      const slug = new URL(href).pathname.split('/').filter(Boolean).pop();
      const title = titleFromSlug(slug) || cleanText($(el).attr('title') || text.replace(/\b(19|20)\d{2}\b.*$/, ''));
      if (!title || !slugify(title).includes(slugify(query))) return;
      const containerText = cleanText($(el).closest('article, .card, li, div').text());
      results.push({
        source: 'DiziFilmizle',
        title,
        url: href,
        poster: absoluteUrl($(el).find('img').attr('src') || $(el).closest('div').find('img').first().attr('src'), finalUrl),
        imdb: parseImdb(containerText),
        year: parseYear(containerText),
        query
      });
    });
    return uniqBy(results, (result) => result.url).slice(0, 10);
  } catch (error) {
    console.error(`DiziFilmizle series search failed for "${query}":`, error.message);
    return [];
  }
}

function extractDiziFilmizleEpisodeUrl(html, seriesUrl, season, episode) {
  const re = new RegExp(`href=["']([^"']*\\/sezon-${season}\\/bolum-${episode}[^"']*)`, 'i');
  const match = html.match(re);
  return match ? absoluteUrl(match[1], seriesUrl) : '';
}

function extractVidmixiEmbeds(html) {
  const urls = [];
  const regex = /embed_player_url_\d+\\?":\\?"([^"\\]+)/g;
  let match;
  while ((match = regex.exec(html)) !== null) urls.push(match[1].replace(/\\\//g, '/'));
  const iframeRegex = /<iframe[^>]+src=["']([^"']*vidmixi\.com\/embed\/[^"']+)/gi;
  while ((match = iframeRegex.exec(html)) !== null) urls.push(match[1]);
  return uniqBy(urls, Boolean);
}

function decryptVidmixiConfig(html) {
  const match = html.match(/bePlayer\(\s*['"]([^'"]+)['"]\s*,\s*'([\s\S]*?)'\s*(?:,|\))/);
  if (!match) return null;
  const hash = match[1];
  const encrypted = match[2].replace(/\\\//g, '/');
  const settings = {
    stringify(cipherParams) {
      const json = { ct: cipherParams.ciphertext.toString(CryptoJS.enc.Base64) };
      if (cipherParams.iv) json.iv = cipherParams.iv.toString();
      if (cipherParams.salt) json.s = cipherParams.salt.toString();
      return JSON.stringify(json);
    },
    parse(jsonStr) {
      const json = JSON.parse(jsonStr);
      const cipherParams = CryptoJS.lib.CipherParams.create({
        ciphertext: CryptoJS.enc.Base64.parse(json.ct)
      });
      if (json.iv) cipherParams.iv = CryptoJS.enc.Hex.parse(json.iv);
      if (json.s) cipherParams.salt = CryptoJS.enc.Hex.parse(json.s);
      return cipherParams;
    }
  };

  try {
    const decrypted = CryptoJS.AES.decrypt(encrypted, hash, { format: settings }).toString(CryptoJS.enc.Utf8);
    return JSON.parse(decrypted);
  } catch (error) {
    return null;
  }
}

async function resolveVidmixiEmbed(embedUrl, pageUrl, sourceName, titlePrefix) {
  try {
    const { html, finalUrl } = await fetchHtml(embedUrl, {
      referer: pageUrl,
      timeout: EMBED_TIMEOUT_MS,
      headers: { Accept: 'text/html,*/*' }
    });
    const config = decryptVidmixiConfig(html);
    if (!config?.video_location) return [];
    const subtitles = Array.isArray(config.strSubtitles)
      ? config.strSubtitles
        .filter((subtitle) => subtitle.file)
        .map((subtitle) => ({
          lang: subtitle.language || subtitle.srclang || 'tur',
          url: absoluteUrl(subtitle.file, finalUrl)
        }))
      : undefined;
    return [{
      source: sourceName,
      title: `${sourceName} ${titlePrefix} [Vidmixi]`,
      url: makeProxyUrl(absoluteUrl(config.video_location, finalUrl), finalUrl),
      quality: 1080,
      subtitles
    }];
  } catch (error) {
    console.error(`${sourceName} Vidmixi resolve failed:`, error.message);
    return [];
  }
}

async function getDiziFilmizleEpisodeStreams(seriesUrl, season, episode) {
  try {
    const first = await fetchHtml(seriesUrl, { referer: `${DIZIFILMIZLE_BASE}/` });
    const episodeUrl = extractDiziFilmizleEpisodeUrl(first.html, first.finalUrl, season, episode);
    if (!episodeUrl) return [];
    const { html, finalUrl } = await fetchHtml(episodeUrl, { referer: first.finalUrl });
    const embeds = extractVidmixiEmbeds(html);
    const resolved = [];
    for (const embedUrl of embeds.slice(0, 2)) {
      resolved.push(...await resolveVidmixiEmbed(embedUrl, finalUrl, 'DiziFilmizle', `[S${season}E${episode}]`));
      if (resolved.length) break;
    }
    return uniqBy(resolved, (stream) => stream.url);
  } catch (error) {
    console.error('DiziFilmizle episode streams failed:', error.message);
    return [];
  }
}

async function searchDiziyouSeries(query) {
  if (/^tt\d+/i.test(query)) return [];
  try {
    const { html, finalUrl } = await fetchHtml(`${DIZIYOU_BASE}/?s=${encodeURIComponent(query)}`, {
      referer: `${DIZIYOU_BASE}/`
    });
    const $ = cheerio.load(html);
    const results = [];
    $('a').each((_, el) => {
      const href = absoluteUrl($(el).attr('href'), finalUrl);
      const text = cleanText($(el).text() || $(el).attr('title'));
      if (!href || !text || /sezon|bölüm|bolum|page\/\d+|\?s=/i.test(href)) return;
      if (!href.startsWith(`${DIZIYOU_BASE}/`)) return;
      const path = new URL(href).pathname;
      const parts = path.split('/').filter(Boolean);
      if (parts.length !== 1) return;
      if (/uye-ol|giris|arsiv|son-eklenenler|page/i.test(parts[0])) return;
      const title = cleanText($(el).attr('title') || text || titleFromSlug(parts[0]));
      if (!slugify(title).includes(slugify(query))) return;
      const containerText = cleanText($(el).closest('article, .result, li, div').text());
      results.push({
        source: 'Diziyou',
        title,
        url: href,
        poster: absoluteUrl($(el).find('img').attr('src') || $(el).closest('div').find('img').first().attr('src'), finalUrl),
        imdb: parseImdb(containerText),
        year: parseYear(containerText),
        query
      });
    });
    return uniqBy(results, (result) => result.url).slice(0, 10);
  } catch (error) {
    console.error(`Diziyou series search failed for "${query}":`, error.message);
    return [];
  }
}

async function getDiziyouEpisodeStreams(seriesUrl, season, episode) {
  try {
    const baseSlug = new URL(seriesUrl).pathname.split('/').filter(Boolean)[0];
    const episodeUrl = `${DIZIYOU_BASE}/${baseSlug}-${season}-sezon-${episode}-bolum/`;
    const { html, finalUrl } = await fetchHtml(episodeUrl, { referer: seriesUrl });
    const $ = cheerio.load(html);
    const iframeUrl = absoluteUrl($('iframe#diziyouPlayer, iframe[src*="/player/"]').first().attr('src'), finalUrl);
    if (!iframeUrl) return [];
    const player = await fetchHtml(iframeUrl, { referer: finalUrl });
    const playerPage = cheerio.load(player.html);
    const streamUrl = absoluteUrl(playerPage('source[type*="mpegURL"], source[src*=".m3u8"]').first().attr('src'), player.finalUrl);
    if (!streamUrl) return [];
    const subtitles = [];
    playerPage('track[src]').each((_, el) => {
      subtitles.push({
        lang: playerPage(el).attr('srclang') || playerPage(el).attr('label') || 'tur',
        url: absoluteUrl(playerPage(el).attr('src'), player.finalUrl)
      });
    });
    return [{
      source: 'Diziyou',
      title: `Diziyou [S${season}E${episode}] [HLS]`,
      url: streamUrl,
      quality: 1080,
      subtitles: subtitles.length ? subtitles : undefined
    }];
  } catch (error) {
    console.error('Diziyou episode streams failed:', error.message);
    return [];
  }
}

function parseDdiziSeriesResult($, el, query) {
  const href = absoluteUrl($(el).attr('href'), DDIZI_BASE);
  const title = cleanText($(el).text())
    .replace(/\s+son\s+bölüm\s+izle.*$/i, '')
    .replace(/\s+hd\d*$/i, '');
  if (!href || !/\/diziler\/\d+\//i.test(href) || !title) return null;
  return {
    source: 'Ddizi',
    title,
    url: href,
    poster: '',
    imdb: 'N/A',
    year: 'N/A',
    query
  };
}

async function searchDdiziSeries(query) {
  if (!query || /^tt\d+$/i.test(query) || /^series\//i.test(query)) return [];
  if (!hasTurkishSeriesSignal([query], query)) return [];
  const searchUrl = `${DDIZI_BASE}/?s=${encodeURIComponent(query)}`;
  try {
    let page;
    try {
      page = await fetchHtml(searchUrl, { referer: `${DDIZI_BASE}/`, timeout: 10000 });
    } catch (error) {
      page = await fetchHtml(`${DDIZI_BASE}/`, { referer: `${DDIZI_BASE}/`, timeout: 10000 });
    }
    const { html } = page;
    const $ = cheerio.load(html);
    const results = [];
    const normalizedQuery = slugify(query).replace(/^series-/, '');
    const shouldFilter = normalizedQuery && !/^tt\d+$/i.test(query) && normalizedQuery.length > 2;
    $('a[href*="/diziler/"]').each((_, el) => {
      const result = parseDdiziSeriesResult($, el, query);
      if (result && shouldFilter) {
        const normalizedTitle = slugify(result.title);
        if (!normalizedTitle.includes(normalizedQuery) && !normalizedQuery.includes(normalizedTitle)) return;
      }
      if (result) results.push(result);
    });
    return uniqBy(results, (result) => result.url).slice(0, 20);
  } catch (error) {
    console.error(`Ddizi series search failed for "${query}":`, error.message);
    return [];
  }
}

function findDdiziEpisodeUrl(html, seriesUrl, season, episode) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href*="/izle/"]').each((_, el) => {
    const href = absoluteUrl($(el).attr('href'), seriesUrl);
    const text = cleanText($(el).text());
    if (href && text) links.push({ href, text });
  });

  const s = Number(season);
  const e = Number(episode);
  const seasonEpisodeRegex = new RegExp(`\\b${s}\\s*\\.\\s*sezon\\s+${e}\\s*\\.\\s*b[oö]l[uü]m\\b`, 'i');
  const episodeRegex = new RegExp(`\\b${e}\\s*\\.\\s*b[oö]l[uü]m\\b`, 'i');
  const hrefSeasonEpisodeRegex = new RegExp(`(?:${s}-sezon-${e}-bolum|sezon-${s}-bolum-${e}|s0?${s}e0?${e})`, 'i');
  const hrefEpisodeRegex = new RegExp(`(?:${e}-bolum|bolum-${e})`, 'i');

  const exactSeason = links.find((link) => seasonEpisodeRegex.test(link.text) || hrefSeasonEpisodeRegex.test(link.href));
  if (exactSeason) return exactSeason.href;

  const exactEpisode = links.find((link) => episodeRegex.test(link.text) || hrefEpisodeRegex.test(link.href));
  return exactEpisode?.href || null;
}

async function resolveDdiziPlayer(playerUrl, episodeUrl) {
  const ytId = extractYouTubeId(playerUrl);
  if (ytId) return { ytId };

  try {
    const { html, finalUrl } = await fetchHtml(playerUrl, {
      referer: episodeUrl,
      timeout: 20000,
      headers: { Accept: 'text/html,*/*' }
    });
    const playerYtId = extractYouTubeId(html);
    if (playerYtId) return { ytId: playerYtId };

    const directUrl = extractUrlsFromText(html)
      .map((url) => absoluteUrl(url, finalUrl))
      .find((url) => /\.(?:m3u8|mp4|mkv|webm)(?:[?#]|$)/i.test(url) || /content_type=video/i.test(url));
    if (directUrl) return { url: makeProxyUrl(directUrl, finalUrl) };
  } catch (error) {
    console.error('Ddizi player resolve failed:', playerUrl, error.message);
  }

  return null;
}

async function getDdiziEpisodeStreams(seriesUrl, season, episode) {
  try {
    const { html, finalUrl } = await fetchHtml(seriesUrl, { referer: `${DDIZI_BASE}/`, timeout: 15000 });
    const episodeUrl = findDdiziEpisodeUrl(html, finalUrl, season, episode);
    if (!episodeUrl) return [];

    const episodePage = await fetchHtml(episodeUrl, { referer: finalUrl, timeout: 15000 });
    const $ = cheerio.load(episodePage.html);
    const iframeUrl = absoluteUrl($('iframe[src*="player"], iframe[src*="youtube"]').first().attr('src'), episodePage.finalUrl);
    if (!iframeUrl) return [];

    const playable = await resolveDdiziPlayer(iframeUrl, episodePage.finalUrl);
    if (!playable) return [];

    return [{
      source: 'Ddizi',
      title: `Ddizi [Yerli/Dublaj] [S${season}E${episode}]`,
      ...playable,
      quality: 1080
    }];
  } catch (error) {
    console.error('Ddizi episode streams failed:', error.message);
    return [];
  }
}

async function searchTvDizilerSeries(query) {
  if (!query || /^tt\d+$/i.test(query) || /^series\//i.test(query)) return [];
  const normalized = slugify(query);
  if (normalized.length < 3) return [];
  return [{
    source: 'TvDiziler',
    title: cleanText(query),
    url: `${TVDIZILER_BASE}/?series=${encodeURIComponent(normalized)}&title=${encodeURIComponent(cleanText(query))}`,
    poster: '',
    imdb: 'N/A',
    year: 'N/A',
    query
  }];
}

async function searchTvDizilerSeriesMany(queries) {
  const title = getYouTubeProviderTitle(queries);
  if (!hasTurkishSeriesSignal(queries, title)) return [];
  return title ? searchTvDizilerSeries(title) : [];
}

function parseTvDizilerSeriesInfo(seriesUrl) {
  try {
    const parsed = new URL(seriesUrl);
    return {
      slug: parsed.searchParams.get('series') || '',
      title: parsed.searchParams.get('title') || ''
    };
  } catch (error) {
    return { slug: '', title: '' };
  }
}

async function findTvDizilerEpisodeUrl(title, slug, episode, season = 1) {
  const candidatePaths = [
    `${slug}-${season}-sezon-${episode}-bolum-full-izle`,
    `${slug}-${season}-sezon-${episode}-bolum-izle`,
    `${slug}-sezon-${season}-bolum-${episode}-izle`,
    `${slug}-${episode}-bolum-full-izle-4`,
    `${slug}-${episode}-bolum-full-izle`,
    `${slug}-${episode}-bolum-izle`,
    `${slug}-${episode}-bolum-izle-full`,
    `${slug}-bolum-${episode}-izle`
  ];

  for (const path of candidatePaths) {
    const url = `${TVDIZILER_BASE}/${path}`;
    try {
      const { html } = await fetchHtml(url, { referer: `${TVDIZILER_BASE}/`, timeout: 8000 });
      if (/youtube|streambox|iframe|player/i.test(html)) return url;
    } catch (error) {
      // Try the search page fallback below.
    }
  }

  const queries = [
    `${title} ${episode}. Bölüm`,
    `${title} ${episode} Bölüm`,
    `${slug.replace(/-/g, ' ')} ${episode} bölüm`
  ];

  for (const query of queries) {
    try {
      const { html, finalUrl } = await fetchHtml(`${TVDIZILER_BASE}/?s=${encodeURIComponent(query)}`, {
        referer: `${TVDIZILER_BASE}/`,
        timeout: 12000
      });
      const $ = cheerio.load(html);
      const links = [];
      $('a[href]').each((_, el) => {
        const href = absoluteUrl($(el).attr('href'), finalUrl);
        const text = cleanText($(el).text());
        if (!href || !text) return;
        if (!href.includes(TVDIZILER_BASE)) return;
        links.push({ href, text });
      });

      const normalizedSlug = slugify(slug || title);
      const episodeRegex = new RegExp(`\\b${episode}\\s*\\.?\\s*b[oö]l[uü]m\\b`, 'i');
      const hrefEpisodeRegex = new RegExp(`(?:${episode}-bolum|bolum-${episode}|s0?${season}e0?${episode}|${season}-sezon-${episode}-bolum|sezon-${season}-bolum-${episode})`, 'i');
      const match = links.find((link) => {
        const normalizedHref = slugify(new URL(link.href).pathname);
        const normalizedText = slugify(link.text);
        return (normalizedHref.includes(normalizedSlug) || normalizedText.includes(normalizedSlug)) &&
          (episodeRegex.test(link.text) || hrefEpisodeRegex.test(link.href));
      });
      if (match) return match.href;
    } catch (error) {
      console.error(`TvDiziler episode search failed for "${query}":`, error.message);
    }
  }

  return null;
}

async function getTvDizilerEpisodeStreams(seriesUrl, season, episode) {
  const { slug, title } = parseTvDizilerSeriesInfo(seriesUrl);
  if (!slug && !title) return [];

  try {
    const episodeUrl = await findTvDizilerEpisodeUrl(title || slug.replace(/-/g, ' '), slug, episode, season);
    if (!episodeUrl) return [];
    const { html, finalUrl } = await fetchHtml(episodeUrl, { referer: `${TVDIZILER_BASE}/`, timeout: 15000 });
    const candidates = extractUrlsFromText(html).map((url) => absoluteUrl(url, finalUrl));
    const ytId = candidates.map(extractYouTubeId).find(Boolean) || extractYouTubeId(html);
    if (ytId) {
      return [{
        source: 'TvDiziler',
        title: `TvDiziler [Yerli] [S${season}E${episode}] [YouTube]`,
        ytId,
        quality: 1080
      }];
    }

    const streamboxUrl = candidates.find((url) => /streambox/i.test(url));
    if (streamboxUrl) {
      try {
        const player = await fetchHtml(streamboxUrl, { referer: finalUrl, timeout: 12000 });
        const streamboxYtId = extractYouTubeId(player.html);
        if (streamboxYtId) {
          return [{
            source: 'TvDiziler',
            title: `TvDiziler [Yerli] [S${season}E${episode}] [YouTube]`,
            ytId: streamboxYtId,
            quality: 1080
          }];
        }
      } catch (error) {
        console.error('TvDiziler streambox resolve failed:', error.message);
      }
    }

    const directUrl = candidates.find((url) => /\.(?:m3u8|mp4|mkv|webm)(?:[?#]|$)/i.test(url));
    if (!directUrl) return [];
    return [{
      source: 'TvDiziler',
      title: `TvDiziler [Yerli] [S${season}E${episode}]`,
      url: makeProxyUrl(directUrl, finalUrl),
      quality: 1080
    }];
  } catch (error) {
    console.error('TvDiziler episode streams failed:', error.message);
    return [];
  }
}

function getYouTubeProviderTitle(queries) {
  const textQueries = queries
    .map((query) => cleanText(query))
    .filter((query) => query && !/^tt\d+$/i.test(query) && !/^series\//i.test(query));
  return textQueries.find((query) => /[ğıüşöçİĞÜŞÖÇ]/.test(query)) || textQueries[0] || '';
}

function hasTurkishSeriesSignal(queries, title) {
  const text = [...queries, title].map((query) => String(query || '')).join(' ');
  if (/[ğıüşöçİĞÜŞÖÇ]/.test(text)) return true;
  return /\b(gonul|dagi|kizil|kizilcik|goncalar|serbeti|esref|ruya|guller|gunahlar|yali|capkini|sen|cal|kapimi)\b/i.test(text);
}

function parseYearFromQueries(queries) {
  return queries.map(parseYear).find((year) => year !== 'N/A') || 'N/A';
}

async function searchYouTubeMovieMany(queries) {
  const title = getYouTubeProviderTitle(queries);
  if (!title) return [];
  const titles = queries
    .map((query) => cleanText(query))
    .filter((query) => query && !/^tt\d+$/i.test(query));
  return [{
    source: 'YouTube',
    title,
    url: `${YOUTUBE_BASE}/results?movie=${encodeURIComponent(title)}&year=${encodeURIComponent(parseYearFromQueries(queries))}&titles=${encodeURIComponent(titles.join('||'))}`,
    poster: '',
    imdb: 'N/A',
    year: parseYearFromQueries(queries),
    query: title
  }];
}

async function searchYouTubeSeriesMany(queries) {
  const title = getYouTubeProviderTitle(queries);
  if (!hasTurkishSeriesSignal(queries, title)) return [];
  if (!title) return [];
  return [{
    source: 'YouTube',
    title,
    url: `${YOUTUBE_BASE}/results?series=${encodeURIComponent(title)}`,
    poster: '',
    imdb: 'N/A',
    year: 'N/A',
    query: title
  }];
}

function parseYouTubeSearchResults(html) {
  const items = [];
  const seen = new Set();
  const regex = /"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,2200}?"title":\{"runs":\[\{"text":"([^"]+)"/g;
  for (const match of String(html).matchAll(regex)) {
    const ytId = match[1];
    const title = htmlDecode(match[2]);
    if (!ytId || seen.has(ytId) || /shorts|fragman|teaser|tanıtım|kamera arkası|final kararı|neden|analiz|yorum/i.test(title)) continue;
    seen.add(ytId);
    items.push({ ytId, title });
  }
  return items;
}

function isYouTubeEpisodeMatch(itemTitle, seriesTitle, episode) {
  const cleanItem = slugify(itemTitle);
  const cleanSeries = slugify(seriesTitle);
  if (!cleanItem.includes(cleanSeries)) return false;
  const text = cleanText(itemTitle);
  const episodeRegex = new RegExp(`\\b${episode}\\s*\\.?\\s*b[oö]l[uü]m\\b`, 'i');
  return episodeRegex.test(text) || new RegExp(`\\b${episode}\\s*\\.\\s*bolum\\b`, 'i').test(slugify(text).replace(/-/g, ' '));
}

function isYouTubeMovieMatch(itemTitle, movieTitles, year) {
  const cleanItem = slugify(itemTitle);
  const titles = Array.isArray(movieTitles) ? movieTitles : [movieTitles];
  if (!titles.some((title) => {
    const cleanMovie = slugify(title);
    return cleanMovie && cleanItem.includes(cleanMovie);
  })) return false;
  if (/review|reaction|explained|ending|interview|behind the scenes|soundtrack|clip|scene|recap|analysis|yorum|inceleme|kamera arkasi|fan\s*made|concept|first trailer/i.test(itemTitle)) return false;
  if (year !== 'N/A' && /\b(?:19|20)\d{2}\b/.test(itemTitle) && !itemTitle.includes(year)) return false;
  return /official|fragman|teaser|tv spot|20th century|disney|movieclips/i.test(itemTitle);
}

async function getYouTubeMovieStreams(movieUrl) {
  try {
    const parsed = new URL(movieUrl);
    const movieTitle = parsed.searchParams.get('movie') || '';
    const year = parsed.searchParams.get('year') || 'N/A';
    const movieTitles = [
      movieTitle,
      ...(parsed.searchParams.get('titles') || '').split('||')
    ].map(cleanText).filter(Boolean);
    if (!movieTitle) return [];

    const queries = uniqBy(movieTitles.flatMap((title) => [
      `${title} ${year !== 'N/A' ? year : ''} official trailer`,
      `${title} official trailer`,
      `${title} fragman`,
      `${title} teaser`
    ]), Boolean);

    for (const query of queries) {
      const { html } = await fetchHtml(`${YOUTUBE_BASE}/results?search_query=${encodeURIComponent(query.replace(/\s+/g, ' ').trim())}`, {
        referer: YOUTUBE_BASE,
        timeout: 15000,
        headers: { Accept: 'text/html,*/*' }
      });
      const match = parseYouTubeSearchResults(html).find((item) => isYouTubeMovieMatch(item.title, movieTitles, year));
      if (match) {
        return [{
          source: 'YouTube',
          title: `YouTube [Trailer] ${match.title}`,
          ytId: match.ytId,
          quality: 1080
        }];
      }
    }
  } catch (error) {
    console.error('YouTube movie streams failed:', error.message);
  }

  return [];
}

async function getYouTubeEpisodeStreams(seriesUrl, season, episode) {
  try {
    const parsed = new URL(seriesUrl);
    const seriesTitle = parsed.searchParams.get('series') || '';
    if (!seriesTitle) return [];

    const queries = [
      `${seriesTitle} ${episode}. Bölüm`,
      `${seriesTitle} ${episode}. Bölüm full`,
      `${seriesTitle} ${episode} bölüm tek parça`
    ];

    for (const query of queries) {
      const { html } = await fetchHtml(`${YOUTUBE_BASE}/results?search_query=${encodeURIComponent(query)}`, {
        referer: YOUTUBE_BASE,
        timeout: 15000,
        headers: { Accept: 'text/html,*/*' }
      });
      const match = parseYouTubeSearchResults(html).find((item) => isYouTubeEpisodeMatch(item.title, seriesTitle, episode));
      if (match) {
        return [{
          source: 'YouTube',
          title: `YouTube [Yerli] [S${season}E${episode}] ${match.title}`,
          ytId: match.ytId,
          quality: 1080
        }];
      }
    }
  } catch (error) {
    console.error('YouTube episode streams failed:', error.message);
  }

  return [];
}

const providers = [
  {
    id: 'jetfilm',
    name: 'JetFilm',
    searchTimeoutMs: 12000,
    streamTimeoutMs: 6000,
    supports: ['movie', 'series'],
    searchMany: (queries) => searchQueries(queries, (query) => searchJetFilm(query), 3500),
    getStreams: getJetFilmStreams,
    searchSeriesMany: (queries) => searchQueries(queries, (query) => searchJetFilm(query, 'series'), 3500),
    getEpisodeStreams: getJetFilmEpisodeStreams
  },
  {
    id: 'fullhd',
    name: 'FullHDFilm',
    searchTimeoutMs: 12000,
    streamTimeoutMs: 15000,
    searchMany: async (queries) => (await searchQueries(queries, fullHd.searchMovies, 3500)).map((result) => ({ ...result, source: 'FullHDFilm' })),
    getStreams: async (url) => (await fullHd.getStreams(url)).map((stream) => ({ ...stream, source: 'FullHDFilm', title: `FullHDFilm ${stream.title}` }))
  },
  {
    id: 'filmmodu',
    name: 'Filmmodu',
    searchTimeoutMs: 12000,
    streamTimeoutMs: 10000,
    searchMany: (queries) => searchQueries(queries, searchFilmmodu, 3500),
    getStreams: getFilmmoduStreams
  },
  {
    id: 'hdfilmcehennemi',
    name: 'HDFilmCehennemi',
    searchTimeoutMs: 12000,
    fastSearchTimeoutMs: 10000,
    streamTimeoutMs: 18000,
    fastStreamTimeoutMs: 12000,
    supports: ['movie', 'series'],
    searchMany: searchHdfilmcehennemiMany,
    getStreams: getHdfilmcehennemiStreams,
    searchSeriesMany: (queries) => searchQueries(queries, searchHdfilmcehennemiSeries, 3500),
    getEpisodeStreams: getHdfilmcehennemiEpisodeStreams
  },
  {
    id: 'dizifilmizle',
    name: 'DiziFilmizle',
    searchTimeoutMs: 12000,
    streamTimeoutMs: 9000,
    supports: ['series'],
    searchSeriesMany: (queries) => searchQueries(queries, searchDiziFilmizleSeries, 8000),
    getEpisodeStreams: getDiziFilmizleEpisodeStreams
  },
  {
    id: 'diziyou',
    name: 'Diziyou',
    searchTimeoutMs: 12000,
    streamTimeoutMs: 7000,
    supports: ['series'],
    searchSeriesMany: (queries) => searchQueries(queries, searchDiziyouSeries, 8000),
    getEpisodeStreams: getDiziyouEpisodeStreams
  },
  {
    id: 'ddizi',
    name: 'Ddizi',
    searchTimeoutMs: 12000,
    streamTimeoutMs: 12000,
    supports: ['series'],
    searchSeriesMany: (queries) => searchQueries(queries, searchDdiziSeries, 10000),
    getEpisodeStreams: getDdiziEpisodeStreams
  },
  {
    id: 'tvdiziler',
    name: 'TvDiziler',
    searchTimeoutMs: 8000,
    streamTimeoutMs: 12000,
    supports: ['series'],
    searchSeriesMany: searchTvDizilerSeriesMany,
    getEpisodeStreams: getTvDizilerEpisodeStreams
  },
  {
    id: 'youtube',
    name: 'YouTube',
    searchTimeoutMs: 3000,
    streamTimeoutMs: 15000,
    fastStreamTimeoutMs: 7000,
    supports: ['movie', 'series'],
    searchMany: searchYouTubeMovieMany,
    getStreams: getYouTubeMovieStreams,
    searchSeriesMany: searchYouTubeSeriesMany,
    getEpisodeStreams: getYouTubeEpisodeStreams
  },
  {
    id: 'webteizle',
    name: 'WebteIzle',
    searchTimeoutMs: 4000,
    streamTimeoutMs: 5000,
    disabledByDefault: true,
    searchMany: (queries) => searchQueries(queries, searchWebteIzle, 5000),
    getStreams: getWebteIzleStreams
  }
];

module.exports = {
  providers,
  searchFilmmodu,
  getFilmmoduStreams,
  searchHdfilmcehennemi,
  getHdfilmcehennemiStreams,
  searchWebteIzle,
  getWebteIzleStreams,
  searchJetFilm,
  getJetFilmStreams,
  getJetFilmEpisodeStreams,
  searchHdfilmcehennemiSeries,
  getHdfilmcehennemiEpisodeStreams,
  searchDiziFilmizleSeries,
  getDiziFilmizleEpisodeStreams,
  searchDiziyouSeries,
  getDiziyouEpisodeStreams,
  searchDdiziSeries,
  getDdiziEpisodeStreams,
  searchTvDizilerSeries,
  searchTvDizilerSeriesMany,
  getTvDizilerEpisodeStreams,
  searchYouTubeMovieMany,
  getYouTubeMovieStreams,
  searchYouTubeSeriesMany,
  getYouTubeEpisodeStreams,
  uniqBy
};
