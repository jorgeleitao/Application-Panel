// Servidor local sem dependências.
// Uso: node server.js  (abre em http://localhost:3000)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1'; // só aceita conexões da própria máquina
const MAX_BODY_BYTES = 5e6;

const DATA_FILE = path.join(__dirname, 'data.json');
const CV_DIR = path.join(__dirname, 'cvs'); // CVs escolhidos no painel ficam aqui
const MAX_CV_BYTES = 10 * 1024 * 1024;

// Tipos de CV aceitos (extensão -> tipo de conteúdo ao abrir no navegador).
const CV_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
};

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

/* ---------- CVs ---------- */

// Devolve um nome de arquivo seguro (sem pastas, sem caracteres estranhos) ou null se o tipo não for aceito.
function safeCvName(rawName) {
  const name = path.basename(String(rawName || ''))
    .replace(/[^\p{L}\p{N}._() -]/gu, '_')
    .trim();

  return CV_TYPES[path.extname(name).toLowerCase()] ? name : null;
}

function listCvs() {
  try {
    return fs.readdirSync(CV_DIR).filter((name) => safeCvName(name) === name).sort();
  } catch (err) {
    return []; // a pasta só é criada no primeiro envio
  }
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

// Recebe o arquivo escolhido no painel e guarda em cvs/. Reenviar o mesmo nome substitui o arquivo.
function handleUploadCv(req, res) {
  const name = safeCvName(new URL(req.url, 'http://localhost').searchParams.get('name'));
  const chunks = [];
  let size = 0;

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size <= MAX_CV_BYTES) chunks.push(chunk);
  });

  req.on('end', () => {
    if (!name) {
      res.writeHead(415);
      return res.end('tipo de arquivo não aceito');
    }
    if (size > MAX_CV_BYTES) {
      res.writeHead(413);
      return res.end('arquivo muito grande');
    }

    try {
      fs.mkdirSync(CV_DIR, { recursive: true });
      fs.writeFileSync(path.join(CV_DIR, name), Buffer.concat(chunks));
      sendJson(res, { name });
    } catch (err) {
      res.writeHead(500);
      res.end('erro ao salvar');
    }
  });
}

// Abre um CV já enviado: GET /cvs/<nome>
function sendCvFile(res, url) {
  let name;
  try {
    name = decodeURIComponent(url.slice('/cvs/'.length));
  } catch (err) {
    name = null;
  }

  const filePath = name && safeCvName(name) === name ? path.join(CV_DIR, name) : null;
  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404);
    return res.end('not found');
  }

  res.writeHead(200, { 'Content-Type': CV_TYPES[path.extname(name).toLowerCase()] });
  res.end(fs.readFileSync(filePath));
}

/* ---------- Rotas ---------- */

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (STATIC_FILES[url]) return sendStaticFile(res, STATIC_FILES[url]);
  if (url === '/api/data' && req.method === 'GET') return sendJson(res, readData());
  if (url === '/api/data' && req.method === 'PUT') return handleSaveData(req, res);
  if (url === '/api/cvs' && req.method === 'GET') return sendJson(res, listCvs());
  if (url === '/api/cv' && req.method === 'PUT') return handleUploadCv(req, res);
  if (url.startsWith('/cvs/') && req.method === 'GET') return sendCvFile(res, url);

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Painel rodando em http://localhost:${PORT}`);
});
