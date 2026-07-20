function isDirectVideoUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.includes('/proxy/')) return true;
  const directExtensions = ['.mp4', '.m3u8', '.mkv', '.avi', '.mov', '.webm'];
  const playlistPatterns = ['master.txt', 'playlist.txt', 'index.txt'];
  if (directExtensions.some((extension) => lower.includes(extension))) return true;
  if (playlistPatterns.some((pattern) => lower.includes(pattern))) return true;
  if (/content[_-]?type=video|mime=video|type=video/.test(lower)) return true;
  if (/\/(?:embed|player|watch|video)(?:\/|\?|$)|\/iframe(?:\/|\?|$)/.test(lower)) return false;

  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const directHosts = [
      'picogallery.org',
      'picturebox.cloud',
      'imagehub.pics',
      'vphotos.org',
      'rupertes.ga',
      'imgsapi.pro',
      'ytconvertor.xyz'
    ];
    return directHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch (error) {
    return lower.includes('/mb/') || lower.includes('/mw/') || lower.includes('/mq/');
  }
}

function getCustomStreams(id) {
  return [];
}

function toStremioStream(stream) {
  return {
    name: stream.name,
    title: stream.title,
    url: stream.url
  };
}

module.exports = {
  isDirectVideoUrl,
  getCustomStreams,
  toStremioStream
};
