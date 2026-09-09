const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DIR = __dirname;
const TOKEN_FILE = path.join(DIR, '.rappi-token');

// Save token on first run
function getToken() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf-8').trim(); } catch { return null; }
}

function saveToken(token) {
  fs.writeFileSync(TOKEN_FILE, token);
}

// Accept token from CLI args
const cliToken = process.argv[2];
if (cliToken) saveToken(cliToken);

let refreshing = false;

const server = http.createServer((req, res) => {
  // Refresh endpoint
  if (req.url === '/refresh') {
    const token = getToken();
    if (!token) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No token saved' }));
    }
    if (refreshing) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Already refreshing' }));
    }

    refreshing = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'started' }));

    console.log('🔄 Refreshing restaurants...');
    execFile('node', ['fetch-restaurants.mjs', token], { cwd: DIR, timeout: 300000 }, (err, stdout, stderr) => {
      refreshing = false;
      if (err) console.error('❌ Refresh failed:', stderr || err.message);
      else console.log('✅ Refresh done');
    });
    return;
  }

  // Check if refresh is done
  if (req.url === '/refresh-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ refreshing }));
  }

  // Static files
  const file = req.url === '/' ? 'map.html' : req.url.slice(1);
  try {
    const data = fs.readFileSync(path.join(DIR, file));
    const ext = file.split('.').pop();
    const mime = { html: 'text/html', json: 'application/json', js: 'text/javascript', css: 'text/css' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(3456, () => {
  const token = getToken();
  console.log('🌐 Server at http://localhost:3456');
  console.log(token ? '🔑 Token loaded' : '⚠️  No token — pass it as: node serve.cjs <token>');
});
