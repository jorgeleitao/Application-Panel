// Servidor local sem dependências.
// Uso: node server.js  (abre em http://localhost:3000)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1'; // só aceita conexões da própria máquina
const MAX_BODY_BYTES = 5e6;

const DATA_FILE = path.join(__dirname, 'data.json');

// Únicos arquivos que o navegador pode baixar (evita expor outras coisas da pasta).
const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};

/* ---------- Dados ---------- */

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    return { apps: [], settings: {} }; // primeira execução ou arquivo ilegível
  }
}

function writeData(data) {
  const tempFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));

  if (fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak'); // guarda a versão anterior
  }
  fs.renameSync(tempFile, DATA_FILE);
}

/* ---------- Respostas ---------- */

function sendStaticFile(res, { file, type }) {
  res.writeHead(200, { 'Content-Type': type });
  res.end(fs.readFileSync(path.join(__dirname, file)));
}

function sendJson(res, payload) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function handleSaveData(req, res) {
  let body = '';

  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) req.destroy();
  });

  req.on('end', () => {
    try {
      const incoming = JSON.parse(body);
      if (!Array.isArray(incoming.apps)) throw new Error('formato inválido');

      writeData({ apps: incoming.apps, settings: incoming.settings || {} });
      res.writeHead(204);
      res.end();
    } catch (err) {
      res.writeHead(400);
      res.end('bad request');
    }
  });
}

/* ---------- Rotas ---------- */

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (STATIC_FILES[url]) return sendStaticFile(res, STATIC_FILES[url]);
  if (url === '/api/data' && req.method === 'GET') return sendJson(res, readData());
  if (url === '/api/data' && req.method === 'PUT') return handleSaveData(req, res);

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Painel rodando em http://localhost:${PORT}`);
});
