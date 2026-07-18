function isDirectVideoUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes('.mp4') || lower.includes('.m3u8') || lower.includes('.mkv') || lower.includes('.avi') || 
         lower.includes('/mb/') || lower.includes('/mw/') || lower.includes('/mq/') || lower.includes('picogallery.org');
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
