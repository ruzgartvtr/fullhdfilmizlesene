const express = require('express');
const path = require('path');

function getPublicBaseUrl() {
  const value = process.env.ADDON_BASE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    `http://127.0.0.1:${process.env.PORT || 7000}`;
  return (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/$/, '');
}

if (!process.env.ADDON_BASE_URL) {
  process.env.ADDON_BASE_URL = getPublicBaseUrl();
}

const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const { createProxyHandler } = require('./proxy');

const PORT = process.env.PORT || 7000;

const app = express();

app.get(['/logo.png', '/favicon.png', '/favicon.ico'], (req, res) => {
  res.type('png');
  res.sendFile(path.join(__dirname, 'LOGO.png'));
});
app.get('/proxy/:payload', createProxyHandler());
app.use(getRouter(addonInterface));

app.get('/', (req, res) => {
  res.redirect('/manifest.json');
});

const server = app.listen(PORT);

server.on('listening', () => {
  const localUrl = `http://127.0.0.1:${server.address().port}/manifest.json`;
  const publicUrl = `${process.env.ADDON_BASE_URL}/manifest.json`;
  console.log(`HTTP addon accessible at: ${publicUrl}`);
  console.log(`Local addon listening at: ${localUrl}`);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Start with another port, for example: PORT=7001 npm start`);
    } else {
      console.error('Failed to start addon server:', error.message);
    }
    process.exit(1);
});
