const express = require('express');
const path = require('path');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const { createProxyHandler } = require('./proxy');

const PORT = process.env.PORT || 7000;

const app = express();

app.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'LOGO.png'));
});
app.get('/proxy/:payload', createProxyHandler());
app.use(getRouter(addonInterface));

app.get('/', (req, res) => {
  res.redirect('/manifest.json');
});

const server = app.listen(PORT);

server.on('listening', () => {
  const url = `http://127.0.0.1:${server.address().port}/manifest.json`;
  if (!process.env.ADDON_BASE_URL) {
    process.env.ADDON_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  }
  console.log(`HTTP addon accessible at: ${url}`);
  console.log(`Addon active on ${url}`);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Start with another port, for example: PORT=7001 npm start`);
    } else {
      console.error('Failed to start addon server:', error.message);
    }
    process.exit(1);
});
