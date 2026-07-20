const axios = require('axios');

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function getAddonBaseUrl() {
  if (process.env.ADDON_BASE_URL) return process.env.ADDON_BASE_URL.replace(/\/$/, '');
  const port = process.env.PORT || 7000;
  return `http://127.0.0.1:${port}`;
}

function makeProxyUrl(url, referer, options = {}) {
  const payload = base64UrlEncode({ url, referer, ...options });
  return `${getAddonBaseUrl()}/proxy/${payload}`;
}

function isHlsManifestUrl(url = '') {
  const lower = String(url).toLowerCase();
  return lower.includes('.m3u8') || lower.includes('master.txt') || lower.includes('playlist.txt');
}

function rewriteHlsUriAttributes(line, sourceUrl, referer) {
  return line.replace(/URI="([^"]+)"/g, (match, uri) => {
    try {
      const absolute = new URL(uri, sourceUrl).href;
      return `URI="${makeProxyUrl(absolute, referer || sourceUrl, { hlsMedia: !isHlsManifestUrl(absolute) })}"`;
    } catch (error) {
      return match;
    }
  });
}

function rewriteM3u8(content, sourceUrl, referer) {
  return String(content).split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) return rewriteHlsUriAttributes(line, sourceUrl, referer);

    try {
      const absolute = new URL(trimmed, sourceUrl).href;
      return makeProxyUrl(absolute, referer || sourceUrl, { hlsMedia: !isHlsManifestUrl(absolute) });
    } catch (error) {
      return line;
    }
  }).join('\n');
}

function getHlsMediaContentType(url = '', upstreamContentType = '') {
  const lowerUrl = String(url).toLowerCase();
  const lowerContentType = String(upstreamContentType).toLowerCase();
  if (lowerContentType && !lowerContentType.includes('text/html')) return upstreamContentType;
  if (/\.(?:m4s|mp4|m4v)(?:[?#]|$)/i.test(lowerUrl)) return 'video/mp4';
  if (/\.(?:vtt)(?:[?#]|$)/i.test(lowerUrl)) return 'text/vtt; charset=utf-8';
  if (/\.(?:aac|m4a)(?:[?#]|$)/i.test(lowerUrl)) return 'audio/mp4';
  return 'video/mp2t';
}

function createProxyHandler() {
  return async (req, res) => {
    let payload;
    try {
      payload = base64UrlDecode(req.params.payload);
      if (!payload.url || !/^https?:\/\//i.test(payload.url)) {
        res.status(400).send('Invalid proxy payload');
        return;
      }
    } catch (error) {
      res.status(400).send('Invalid proxy payload');
      return;
    }

    const headers = {
      'User-Agent': req.get('user-agent') || 'Mozilla/5.0',
      'Accept': req.get('accept') || '*/*'
    };
    if (payload.referer) headers.Referer = payload.referer;
    if (req.get('range')) headers.Range = req.get('range');

    try {
      if (payload.hlsMedia) {
        const upstream = await axios.get(payload.url, {
          headers,
          responseType: 'stream',
          timeout: 60000,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 500
        });

        if (upstream.status >= 400) {
          res.status(upstream.status).send(`Upstream returned ${upstream.status}`);
          upstream.data.destroy();
          return;
        }

        res.status(upstream.status);
        res.setHeader('access-control-allow-origin', '*');
        res.setHeader('access-control-allow-headers', 'Range, Origin, Accept, Content-Type');
        res.setHeader('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges');
        res.setHeader('content-type', getHlsMediaContentType(payload.url, upstream.headers['content-type']));
        if (upstream.headers['content-length']) res.setHeader('content-length', upstream.headers['content-length']);
        if (upstream.headers['content-range']) res.setHeader('content-range', upstream.headers['content-range']);
        if (upstream.headers['accept-ranges']) res.setHeader('accept-ranges', upstream.headers['accept-ranges']);
        upstream.data.on('error', () => res.end());
        upstream.data.pipe(res);
        return;
      }

      const upstream = await axios.get(payload.url, {
        headers,
        responseType: 'arraybuffer',
        timeout: 30000,
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 500
      });

      if (upstream.status >= 400) {
        res.status(upstream.status).send(`Upstream returned ${upstream.status}`);
        return;
      }

      res.status(upstream.status);
      const contentType = upstream.headers['content-type'] || 'application/octet-stream';
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', 'Range, Origin, Accept, Content-Type');
      res.setHeader('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges');
      res.setHeader('content-type', payload.hlsMedia ? 'video/mp2t' : contentType);
      if (upstream.headers['content-range']) res.setHeader('content-range', upstream.headers['content-range']);
      if (upstream.headers['accept-ranges']) res.setHeader('accept-ranges', upstream.headers['accept-ranges']);

      const body = Buffer.from(upstream.data);
      const text = body.toString('utf8');
      if (contentType.toLowerCase().includes('mpegurl') || text.startsWith('#EXTM3U')) {
        res.setHeader('content-type', 'application/vnd.apple.mpegurl');
        res.send(rewriteM3u8(text, payload.url, payload.referer));
        return;
      }

      res.send(body);
    } catch (error) {
      res.status(502).send(`Proxy fetch failed: ${error.message}`);
    }
  };
}

module.exports = {
  makeProxyUrl,
  createProxyHandler,
  rewriteM3u8,
  getHlsMediaContentType
};
