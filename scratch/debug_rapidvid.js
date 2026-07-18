const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Referer': 'https://www.fullhdfilmizlesene.nz/'
};

async function check() {
  try {
    const url = 'https://rapidvid.net/vod/v1x264296bd';
    const response = await axios.get(url, { headers: HEADERS });
    const $ = cheerio.load(response.data);
    
    $('script').each((i, el) => {
      const text = $(el).text();
      if (text.includes('function av') || text.includes('av =')) {
        console.log(`Found av in script ${i}:`);
        const lines = text.split('\n');
        lines.forEach((line) => {
          if (line.includes('av') || line.includes('function')) {
            console.log(line.trim());
          }
        });
      }
    });

  } catch (error) {
    console.error('Error:', error.message);
  }
}

check();
