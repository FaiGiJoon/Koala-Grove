import fs from 'node:fs';
import path from 'node:path';
import config from './hq/config.js';
import { createApp } from './hq/http.js';
import { Grove } from './hq/grove.js';
import { Google } from './hq/google.js';

fs.mkdirSync(config.dataDir, { recursive: true });
const grove = new Grove({
  path: path.join(config.dataDir, 'grove.sqlite'),
  config: { ...config.grove, workDir: path.join(config.workDir, 'grove') },
});
const google = new Google({ dataDir: config.dataDir });
const server = createApp({ grove, publicDir: path.join(config.root, 'public'), google, publicHosts: config.publicHosts });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Koala Grove: port ${config.port} is already in use. Is the grove already running? Set PORT to use another port.`);
  } else {
    console.error('Koala Grove could not start:', err.message);
  }
  process.exit(1);
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Koala Grove on http://127.0.0.1:${server.address().port}`);
  grove.start();
});
