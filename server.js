const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./addon');

const PORT = process.env.PORT || 7000;

serveHTTP(addonInterface, { port: PORT })
  .then(({ url }) => {
    console.log(`Addon active on ${url}`);
  })
  .catch((error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Start with another port, for example: PORT=7001 npm start`);
    } else {
      console.error('Failed to start addon server:', error.message);
    }
    process.exit(1);
  });
