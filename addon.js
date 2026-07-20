const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const scraper = require('./scraper');
const customStreams = require('./customStreams');
const { providers, uniqBy } = require('./providers');
const { memoizeAsync, clearExpired } = require('./cache');

const CINEMETA_URL = 'https://v3-cinemeta.strem.io/meta';
const PROVIDER_TIMEOUT_MS = 10000;
const META_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000;
const STREAM_CACHE_TTL_MS = 4 * 60 * 1000;
const ALIAS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';
const YOUTUBE_STREAM_MODE = String(process.env.YOUTUBE_STREAM_MODE || 'on').toLowerCase();
const YOUTUBE_FALLBACK_ONLY = process.env.YOUTUBE_FALLBACK_ONLY === '1';
const FAST_RESPONSE_MODE = process.env.FAST_RESPONSE_MODE !== '0';
const FAST_SEARCH_TIMEOUT_MS = Number(process.env.FAST_SEARCH_TIMEOUT_MS || 3500);
const FAST_STREAM_TIMEOUT_MS = Number(process.env.FAST_STREAM_TIMEOUT_MS || 6500);
const FAST_MAX_SEARCH_QUERIES = Number(process.env.FAST_MAX_SEARCH_QUERIES || 5);
const FAST_MAX_SOURCES = Number(process.env.FAST_MAX_SOURCES || 3);
const FAST_MOVIE_SEARCH_SOURCES = Number(process.env.FAST_MOVIE_SEARCH_SOURCES || 1);
const FAST_FOREIGN_MOVIE_SEARCH_SOURCES = Number(process.env.FAST_FOREIGN_MOVIE_SEARCH_SOURCES || 4);
const FAST_SERIES_SEARCH_SOURCES = Number(process.env.FAST_SERIES_SEARCH_SOURCES || 2);
function getAddonBaseUrl() {
    const value = process.env.ADDON_BASE_URL ||
        process.env.VERCEL_PROJECT_PRODUCTION_URL ||
        process.env.VERCEL_URL ||
        `http://127.0.0.1:${process.env.PORT || 7000}`;
    return (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/$/, '');
}

const ADDON_BASE_URL = getAddonBaseUrl();
const TITLE_ALIASES = {
    tt19394770: ['Atatürk 1881 1919 2023', 'Ataturk 1881 1919 2023', 'Atatürk 1881 1919', 'Ataturk 1881 1919', 'Atatürk', 'Ataturk'],
    tt19396786: ['Atatürk 2 1881 1919', 'Atatürk II 1881 1919', 'Ataturk 2 1881 1919', 'Ataturk II 1881 1919', 'Atatürk 2', 'Ataturk 2'],
    tt0384116: ['GORA 2004', 'GORA', 'G O R A'],
    tt0458352: ['Şeytan Marka Giyer', 'Seytan Marka Giyer', 'The Devil Wears Prada 2006', 'Devil Wears Prada'],
    tt12872884: ['Gönül Dağı', 'Gonul Dagi'],
    tt21764074: ['Kızılcık Şerbeti', 'Kizilcik Serbeti'],
    tt35069642: ['Eşref Rüya', 'Esref Ruya'],
    tt38074086: ['Güller ve Günahlar', 'Guller ve Gunahlar'],
    tt21105088: ['Yalı Çapkını', 'Yali Capkini'],
    tt28334662: ['Kızıl Goncalar', 'Kizil Goncalar'],
    tt12439466: ['Sen Çal Kapımı', 'Sen Cal Kapimi'],
    tt1848220: ['Muhteşem Yüzyıl', 'Muhtesem Yuzyil'],
    tt0441924: ['Gümüş', 'Gumus']
};
const NAME_ALIASES = {
    'an anatolian tale': ['Gönül Dağı', 'Gonul Dagi'],
    'cranberry sorbet': ['Kızılcık Şerbeti', 'Kizilcik Serbeti'],
    'eshref ruya': ['Eşref Rüya', 'Esref Ruya'],
    'sins and roses': ['Güller ve Günahlar', 'Guller ve Gunahlar'],
    'golden boy': ['Yalı Çapkını', 'Yali Capkini'],
    'red roses': ['Kızıl Goncalar', 'Kizil Goncalar'],
    'love is in the air': ['Sen Çal Kapımı', 'Sen Cal Kapimi'],
    'the magnificent century': ['Muhteşem Yüzyıl', 'Muhtesem Yuzyil'],
    'gumus': ['Gümüş', 'Gumus'],
    'the devil wears prada': ['Şeytan Marka Giyer', 'Seytan Marka Giyer'],
    'devil wears prada': ['Şeytan Marka Giyer', 'Seytan Marka Giyer']
};

const manifest = {
    id: 'community.turkish-film-sources',
    version: '2.1.0',
    name: 'Turkish Film Sources',
    description: 'Turkish movie and series streams from FullHDFilmizlesene, JetFilm, Filmmodu, HDFilmCehennemi, DiziFilmizle, Diziyou, Ddizi, TvDiziler, YouTube and WebteIzle and more.',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    background: 'https://img.fullhdfilmizlesene.nz/temalar/flex/images/default_user.svg',
    logo: `${ADDON_BASE_URL}/logo.png`,
    catalogs: []
};

const builder = new addonBuilder(manifest);

// Helper function to resolve IMDb ID to Movie metadata (Name & Year) via Cinemeta
async function getMetaFromImdb(type, imdbId) {
    return memoizeAsync(`meta:${type}:${imdbId}`, META_CACHE_TTL_MS, async() => {
        const url = `${CINEMETA_URL}/${type}/${imdbId}.json`;
        const attempts = FAST_RESPONSE_MODE ? 1 : 2;
        const timeout = FAST_RESPONSE_MODE ? 4000 : 15000;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const response = await axios.get(url, { timeout });
                if (response.data && response.data.meta) {
                    return response.data.meta;
                }
            } catch (error) {
                console.error(`Failed to fetch cinemeta for ${imdbId} (attempt ${attempt}):`, error.message);
            }
        }
        return null;
    });
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

function isMissingYear(resultYear) {
    return !resultYear || String(resultYear).trim().toUpperCase() === 'N/A';
}

function parseRating(rating) {
    const number = Number.parseFloat(String(rating || '').replace(',', '.'));
    return Number.isFinite(number) ? number : null;
}

function isRatingClose(resultRating, queryRating) {
    const result = parseRating(resultRating);
    const query = parseRating(queryRating);
    return result !== null && query !== null && Math.abs(result - query) <= 0.25;
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
    if (parts.some((part) => part === cleanQuery || part.endsWith(` ${cleanQuery}`))) return 90;
    if (cleanResult.includes(` ${cleanQuery} `) || cleanResult.startsWith(`${cleanQuery} `) || cleanResult.endsWith(` ${cleanQuery}`)) return 85;

    return 0;
}

function findBestMatch(searchResults, queryTitle, queryYear, options = {}) {
    const imdbRating = options.imdbRating;
    const imdbId = options.imdbId;

    return searchResults
        .map((result) => {
            const titleScore = getTitleScore(result.title, queryTitle);
            const yearMatches = isYearMatch(result.year, queryYear);
            const ratingMatches = isRatingClose(result.imdb, imdbRating);
            const imdbQueryMatches = Boolean(imdbId && (result.query === imdbId || result.imdbId === imdbId));
            const score = titleScore +
                (yearMatches ? 50 : 0) +
                (ratingMatches ? 25 : 0) +
                (imdbQueryMatches ? 60 : 0);

            return {
                result,
                score,
                titleScore,
                yearMatches,
                ratingMatches,
                imdbQueryMatches
            };
        })
        .filter((candidate) => {
            if (!candidate.yearMatches) return false;
            if (candidate.titleScore >= 85) return true;
            return candidate.imdbQueryMatches && (candidate.ratingMatches || candidate.titleScore > 0);
        })
        .sort((a, b) => b.score - a.score)[0]?.result || null;
}

function scoreMatch(result, queryTitle, queryYear, options = {}) {
    const titleScore = [queryTitle, ...(options.titleAliases || [])]
        .map((title) => getTitleScore(result.title, title))
        .sort((a, b) => b - a)[0] || 0;
    const yearMatches = isYearMatch(result.year, queryYear);
    const yearMissing = isMissingYear(result.year);
    const ratingMatches = isRatingClose(result.imdb, options.imdbRating);
    const imdbQueryMatches = Boolean(options.imdbId && (result.query === options.imdbId || result.imdbId === options.imdbId));
    const score = titleScore +
        (yearMatches ? 50 : 0) +
        (ratingMatches ? 25 : 0) +
        (imdbQueryMatches ? 60 : 0);

    return {
        result,
        score,
        titleScore,
        yearMatches,
        yearMissing,
        ratingMatches,
        imdbQueryMatches
    };
}

function isConfidentMatch(candidate) {
    if (candidate.allowTitleOnly && candidate.titleScore >= 95) return true;
    if (candidate.yearMissing && candidate.titleScore >= 95) return true;
    if (!candidate.yearMatches && !(candidate.imdbQueryMatches && candidate.titleScore >= 85)) return false;
    if (candidate.imdbQueryMatches && candidate.yearMatches) return true;
    if (candidate.imdbQueryMatches && candidate.yearMissing && candidate.titleScore >= 95) return true;
    if (candidate.titleScore >= 85) return true;
    return candidate.imdbQueryMatches && (candidate.ratingMatches || candidate.titleScore > 0);
}

function rankMatchesBySource(searchResults, queryTitle, queryYear, options = {}) {
    const rankedBySource = new Map();
    const maxPerSource = options.maxPerSource || 3;

    const ranked = searchResults
        .map((result) => ({
            ...scoreMatch(result, queryTitle, queryYear, options),
            allowTitleOnly: Boolean(options.allowTitleOnly)
        }))
        .filter(isConfidentMatch)
        .sort((a, b) => b.score - a.score);

    for (const candidate of ranked) {
        const source = candidate.result.source || 'Unknown';
        const items = rankedBySource.get(source) || [];
        if (items.length < maxPerSource) {
            items.push(candidate.result);
            rankedBySource.set(source, items);
        }
    }

    return rankedBySource;
}

function findBestMatchesBySource(searchResults, queryTitle, queryYear, options = {}) {
    const rankedBySource = rankMatchesBySource(searchResults, queryTitle, queryYear, options);
    return [...rankedBySource.values()].map((items) => items[0]).filter(Boolean);
}

function describeMatches(matches) {
    return matches.map((match) => `[${match.source}] "${match.title}"`).join(', ');
}

function getProviderPriority(provider, contentType) {
    const seriesPriority = {
        YouTube: 0,
        TvDiziler: 1,
        HDFilmCehennemi: 2,
        Ddizi: 3,
        DiziFilmizle: 4,
        Diziyou: 5,
        JetFilm: 6
    };
    const moviePriority = {
        HDFilmCehennemi: 0,
        FullHDFilm: 1,
        JetFilm: 2,
        Filmmodu: 3,
        WebteIzle: 4
    };
    const table = contentType === 'series' ? seriesPriority : moviePriority;
    return table[provider.name] ?? 50;
}

function sortProvidersForSpeed(providersToSort, contentType) {
    return [...providersToSort].sort((a, b) => getProviderPriority(a, contentType) - getProviderPriority(b, contentType));
}

function getFastSearchQueries(queries) {
    if (!FAST_RESPONSE_MODE) return queries;
    const scored = queries
        .map((query, index) => {
            const text = String(query || '');
            let score = index;
            if (/^tt\d+$/i.test(text)) score -= 100;
            if (/\b(?:19|20)\d{2}\b/.test(text)) score -= 20;
            if (/[ğıüşöçİĞÜŞÖÇ]/.test(text)) score -= 10;
            return { query: text, score };
        })
        .sort((a, b) => a.score - b.score)
        .map((item) => item.query);
    return [...new Set(scored)].slice(0, FAST_MAX_SEARCH_QUERIES);
}

function getEffectiveTimeout(providerTimeout, fallbackTimeout, fastTimeout) {
    const normal = providerTimeout || fallbackTimeout;
    return FAST_RESPONSE_MODE ? Math.min(normal, fastTimeout) : normal;
}

function hasTurkishText(text = '') {
    return /[ğıüşöçİĞÜŞÖÇ]/.test(String(text));
}

function getSearchProviders(activeProviders, contentType, options = {}) {
    if (!FAST_RESPONSE_MODE) return activeProviders;
    let maxSources = contentType === 'series' ? FAST_SERIES_SEARCH_SOURCES : FAST_MOVIE_SEARCH_SOURCES;
    if (contentType === 'movie' && !hasTurkishText(options.queryTitle) && (!options.hasLocalAliases || options.hasTurkishAliases)) {
        maxSources = FAST_FOREIGN_MOVIE_SEARCH_SOURCES;
    }
    return activeProviders.slice(0, Math.max(1, maxSources));
}

async function scrapeProviderMatches(provider, matches, contentType, season, episode) {
    if (!provider) return [];

    for (const match of matches) {
        const streams = await withTimeout(
            memoizeAsync(
                `streams:${contentType}:${provider.id}:${match.url}:${season || 0}:${episode || 0}`,
                STREAM_CACHE_TTL_MS,
                () => contentType === 'series' ?
                provider.getEpisodeStreams(match.url, season, episode) :
                provider.getStreams(match.url)
            ),
            getEffectiveTimeout(provider.streamTimeoutMs, PROVIDER_TIMEOUT_MS, provider.fastStreamTimeoutMs || FAST_STREAM_TIMEOUT_MS), [],
            `[${provider.name}] streams`
        );
        console.log(`[${provider.name}] Scraped ${streams.length} stream links from ${match.url}`);
        const playable = applyStreamPreferences(streams);
        if (playable.length > 0) return playable;
    }

    return [];
}

async function scrapeRankedMatches(rankedMatchesBySource, activeProviders, contentType, season, episode) {
    const sourceEntries = [...rankedMatchesBySource.entries()]
        .map(([source, matches]) => ({
            source,
            matches,
            provider: activeProviders.find((item) => item.name === source)
        }))
        .filter((entry) => entry.provider)
        .sort((a, b) => getProviderPriority(a.provider, contentType) - getProviderPriority(b.provider, contentType));

    if (!FAST_RESPONSE_MODE) {
        return Promise.all(sourceEntries.map((entry) => scrapeProviderMatches(entry.provider, entry.matches, contentType, season, episode)));
    }

    const fastEntries = sourceEntries.slice(0, FAST_MAX_SOURCES);
    const allEntries = fastEntries.length > 0 ? fastEntries : sourceEntries;
    const attempts = allEntries.map((entry) =>
        scrapeProviderMatches(entry.provider, entry.matches.slice(0, 2), contentType, season, episode)
        .then((streams) => {
            if (streams.length === 0) throw new Error(`${entry.source} returned no playable streams`);
            return streams;
        })
    );

    try {
        return [await Promise.any(attempts)];
    } catch (error) {
        return [];
    }
}

function buildSearchQueries(imdbId, meta, dynamicAliases = []) {
    const queries = [imdbId, meta.name, ...getTitleAliases(imdbId, meta.name, dynamicAliases)];
    const metaYear = String(meta.year || meta.releaseInfo || '').match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
    if (metaYear && meta.name && !String(meta.name).includes(metaYear)) {
        queries.push(`${meta.name} ${metaYear}`);
    }

    const punctuationFreeTitle = String(meta.name || '')
        .replace(/[()[\]{}:;,.!?'"]/g, ' ')
        .replace(/[–—-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (punctuationFreeTitle && punctuationFreeTitle !== meta.name) {
        queries.push(punctuationFreeTitle);
        if (metaYear && !punctuationFreeTitle.includes(metaYear)) {
            queries.push(`${punctuationFreeTitle} ${metaYear}`);
        }
    }

    if (meta.slug) {
        const slugTitle = meta.slug
            .replace(/^movie\//, '')
            .replace(/-\d+$/, '')
            .replace(/-/g, ' ');
        if (cleanTitle(slugTitle) !== cleanTitle(meta.name)) queries.push(slugTitle);
    }

    return [...new Set(queries.filter(Boolean))];
}

function getStaticTitleAliases(imdbId, title = '') {
    return [...new Set([
        ...(TITLE_ALIASES[imdbId] || []),
        ...(NAME_ALIASES[cleanTitle(title)] || [])
    ])];
}

function normalizeAlias(title = '') {
    return String(title)
        .replace(/\s+\(\d{4}\)\s*$/g, '')
        .replace(/\s+\((?:film|dizi|anime|televizyon dizisi|TV dizisi)\)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isUsefulAlias(alias, originalTitle = '') {
    const normalized = normalizeAlias(alias);
    if (!normalized || normalized.length < 2 || normalized.length > 80) return false;
    if (/^Q\d+$/.test(normalized)) return false;
    return cleanTitle(normalized) !== cleanTitle(originalTitle);
}

async function getWikidataTitleAliases(imdbId, originalTitle = '') {
    if (!/^tt\d+$/i.test(imdbId)) return [];

    return memoizeAsync(`alias:wikidata:${imdbId}`, ALIAS_CACHE_TTL_MS, async() => {
        const query = `
SELECT ?trLabel ?trAlt ?trWikiTitle WHERE {
  ?item wdt:P345 "${imdbId}".
  OPTIONAL { ?item rdfs:label ?trLabel FILTER(LANG(?trLabel)="tr") }
  OPTIONAL { ?item skos:altLabel ?trAlt FILTER(LANG(?trAlt)="tr") }
  OPTIONAL {
    ?trWiki schema:about ?item;
      schema:isPartOf <https://tr.wikipedia.org/>;
      schema:name ?trWikiTitle.
  }
}
LIMIT 40`;

        try {
            const response = await axios.get(WIKIDATA_SPARQL_URL, {
                timeout: 8000,
                params: { query },
                headers: {
                    Accept: 'application/sparql-results+json',
                    'User-Agent': 'TurkishStremioAddon/2.0'
                }
            });

            const aliases = [];
            for (const row of response.data?.results?.bindings || []) {
                aliases.push(
                    row.trLabel?.value,
                    row.trAlt?.value,
                    row.trWikiTitle?.value
                );
            }

            return [...new Set(aliases.map(normalizeAlias).filter((alias) => isUsefulAlias(alias, originalTitle)))].slice(0, 12);
        } catch (error) {
            console.error(`Wikidata alias lookup failed for ${imdbId}:`, error.message);
            return [];
        }
    });
}

async function getFallbackMetaFromAliases(imdbId, type) {
    const staticAliases = getStaticTitleAliases(imdbId, '');
    const dynamicAliases = await getWikidataTitleAliases(imdbId, '');
    let name = staticAliases[0] || dynamicAliases[0];
    if (!name) return null;
    const years = String(name).match(/\b(?:19|20)\d{2}\b/g) || [];
    const year = years.length > 0 ? years[years.length - 1] : '';
    if (year) {
        name = name.replace(new RegExp(`\\s+${year}\\s*$`), '').trim();
    }

    return {
        id: imdbId,
        imdb_id: imdbId,
        type,
        name,
        year
    };
}

function getTitleAliases(imdbId, title = '', dynamicAliases = []) {
    return [...new Set([
        ...getStaticTitleAliases(imdbId, title),
        ...dynamicAliases
    ])];
}

function withTimeout(promise, timeoutMs, fallback, label) {
    let timeout;
    const timeoutPromise = new Promise((resolve) => {
        timeout = setTimeout(() => {
            console.error(`${label} timed out after ${timeoutMs}ms`);
            resolve(fallback);
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function getLanguagePriority(title = '') {
    const lower = String(title).toLocaleLowerCase('tr-TR');
    if (lower.includes('dublaj') || lower.includes('yerli')) return 3;
    if (lower.includes('dil+')) return 2;
    if (lower.includes('altyaz')) return 1;
    return 0;
}

function isYouTubeProviderEnabled() {
    return YOUTUBE_STREAM_MODE !== 'off' && YOUTUBE_STREAM_MODE !== 'disabled';
}

function applyStreamPreferences(streams) {
    const playable = streams.filter((s) => s.ytId || customStreams.isDirectVideoUrl(s.url));
    const directStreams = playable.filter((s) => s.url);
    if (YOUTUBE_FALLBACK_ONLY && directStreams.length > 0) {
        return directStreams;
    }
    return playable;
}

builder.defineStreamHandler(async(args) => {
    clearExpired();
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

    if (type === 'series' && (!season || !episode)) {
        console.log(`Series request is missing season/episode. IMDb ID: ${imdbId}`);
        return { streams: [] };
    }

    // 1. Resolve IMDb ID to movie/series info
    const contentType = type === 'series' ? 'series' : 'movie';
    let meta = await getMetaFromImdb(contentType, imdbId);
    if (!meta || !meta.name) {
        meta = await getFallbackMetaFromAliases(imdbId, contentType);
    }
    if (!meta || !meta.name) {
        console.log(`Could not resolve meta for IMDb ID: ${imdbId}`);
        return { streams: [] };
    }

    const queryTitle = meta.name;
    const yearText = meta.year || meta.releaseInfo || '';
    const queryYear = yearText ? String(yearText).split('–')[0].trim() : '';
    console.log(`Resolved Meta - Title: "${queryTitle}", Year: "${queryYear}"`);
    const localAliases = getTitleAliases(imdbId, queryTitle, []);
    const hasLocalAliases = localAliases.length > 0;
    const dynamicAliases = localAliases.length > 0 ? [] : await getWikidataTitleAliases(imdbId, queryTitle);
    if (dynamicAliases.length > 0) {
        console.log(`Dynamic aliases for ${imdbId}: ${dynamicAliases.join(', ')}`);
    }

    // 2. Search every provider by IMDb ID first, then by title. IMDb search helps with localized Turkish titles.
    const searchQueries = getFastSearchQueries(buildSearchQueries(imdbId, meta, dynamicAliases));
    const activeProviders = sortProvidersForSpeed(providers.filter((provider) => {
        if (provider.id === 'youtube' && !isYouTubeProviderEnabled()) return false;
        if (contentType === 'series') return typeof provider.searchSeriesMany === 'function' && typeof provider.getEpisodeStreams === 'function';
        if (provider.disabledByDefault && process.env.ENABLE_SLOW_PROVIDERS !== '1') return false;
        return typeof provider.searchMany === 'function' && typeof provider.getStreams === 'function' && (!provider.supports || provider.supports.includes('movie'));
    }), contentType);
    const searchProviders = getSearchProviders(activeProviders, contentType, {
        queryTitle,
        hasLocalAliases,
        hasTurkishAliases: [...localAliases, ...dynamicAliases].some(hasTurkishText)
    });
    const searchProvider = async(provider) => {
        const results = await withTimeout(
            memoizeAsync(
                `search:${contentType}:${provider.id}:${searchQueries.join('|')}`,
                SEARCH_CACHE_TTL_MS,
                () => contentType === 'series' ? provider.searchSeriesMany(searchQueries) : provider.searchMany(searchQueries)
            ),
            getEffectiveTimeout(provider.searchTimeoutMs, PROVIDER_TIMEOUT_MS, provider.fastSearchTimeoutMs || FAST_SEARCH_TIMEOUT_MS), [],
            `[${provider.name}] search`
        );
        console.log(`[${provider.name}] Found ${results.length} search results for queries: ${searchQueries.join(', ')}`);
        return { provider, results };
    };
    const providerSearches = await Promise.all(searchProviders.map(searchProvider));
    let searchResults = providerSearches.flatMap(({ results }) => results);

    if (searchResults.length === 0 && searchProviders.length < activeProviders.length) {
        const searchedProviderIds = new Set(searchProviders.map((provider) => provider.id));
        const fallbackProviders = activeProviders.filter((provider) => !searchedProviderIds.has(provider.id));
        console.log(`No fast results for "${queryTitle}". Trying ${fallbackProviders.length} fallback providers.`);
        const fallbackSearches = await Promise.all(fallbackProviders.map(searchProvider));
        searchResults = fallbackSearches.flatMap(({ results }) => results);
    }

    if (searchResults.length === 0) {
        return { streams: [] };
    }

    // 3. Find one confident match per source. Do not fall back to random first results.
    const rankedMatchesBySource = rankMatchesBySource(searchResults, queryTitle, queryYear, {
        imdbId,
        imdbRating: meta.imdbRating,
        titleAliases: getTitleAliases(imdbId, queryTitle, dynamicAliases),
        allowTitleOnly: contentType === 'series',
        maxPerSource: 3
    });
    let bestMatches = [...rankedMatchesBySource.values()].map((items) => items[0]).filter(Boolean);

    if (bestMatches.length === 0) {
        console.log(`No confident match for "${queryTitle}" (${queryYear}). Returning no streams.`);
        return { streams: [] };
    }

    console.log(`Selected Matches: ${describeMatches(bestMatches)}`);

    // 4. Scrape stream URLs from ranked providers. Fast mode returns as soon as a playable source is found.
    const scrapedBySource = await scrapeRankedMatches(rankedMatchesBySource, activeProviders, contentType, season, episode);

    const streams = applyStreamPreferences(uniqBy(scrapedBySource.flat(), (s) => s.url || s.ytId))
        .map((s) => {
            // Stremio can play direct video and HLS URLs. Unresolved embed pages are skipped.
            return {
                name: s.source || 'Film Kaynağı',
                title: s.title,
                url: s.url,
                ytId: s.ytId,
                subtitles: s.subtitles
            };
        })
        .sort((a, b) => {
            const langDiff = getLanguagePriority(b.title) - getLanguagePriority(a.title);
            if (langDiff !== 0) return langDiff;
            const aq = Number(String(a.title).match(/\[(\d{3,4})p\]/)?.[1] || 0);
            const bq = Number(String(b.title).match(/\[(\d{3,4})p\]/)?.[1] || 0);
            return bq - aq;
        });

    return { streams, cacheMaxAge: streams.length > 0 ? 600 : 60 };
});

module.exports = builder.getInterface();
module.exports._private = {
    cleanTitle,
    findBestMatch,
    rankMatchesBySource,
    findBestMatchesBySource,
    getTitleScore,
    buildSearchQueries,
    getTitleAliases,
    getStaticTitleAliases,
    getWikidataTitleAliases,
    getFallbackMetaFromAliases,
    isMissingYear,
    isRatingClose,
    getLanguagePriority,
    applyStreamPreferences,
    isYouTubeProviderEnabled,
    getFastSearchQueries,
    sortProvidersForSpeed,
    getProviderPriority,
    getSearchProviders
};
