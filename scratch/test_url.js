const axios = require('axios');

async function checkUrl() {
  const url = 'https://s1.picogallery.org/mb/DKMuqTSlYwVjZQxhEIuHEH5REHDhHxIDDHAYYwRjBQOjYxWfqIWurGZmd0zxpTywo2quoTkypaxho3Was0xi1vr1';
  try {
    console.log('Sending HEAD/GET request to:', url);
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://rapidvid.net/'
      }
    });
    console.log('Status:', res.status);
    console.log('Headers:', res.headers);
    console.log('Content snippet (first 500 chars):');
    console.log(res.data.toString().substring(0, 500));
  } catch (err) {
    console.error('Error fetching stream:', err.message);
    if (err.response) {
      console.log('Status:', err.response.status);
      console.log('Headers:', err.response.headers);
    }
  }
}

checkUrl();
