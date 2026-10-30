// Servidor local sem dependências.
// Uso: node server.js  (abre em http://localhost:3000)
//
// Guarda as candidaturas em data.json e os CVs escolhidos no painel na pasta cvs/.

const http = require('http');
const fs = require('fs');
const path = require('path');

/* ---------- Configuração ---------- */

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1'; // só aceita conexões da própria máquina

const DATA_FILE = path.join(__dirname, 'data.json');
const CV_DIR = path.join(__dirname, 'cvs');

const MAX_DATA_BYTES = 5e6;
const MAX_CV_BYTES = 10 * 1024 * 1024;

// Tipos de CV aceitos (extensão -> tipo de conteúdo ao abrir no navegador).
const CV_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
};

// Únicos arquivos que o navegador pode baixar (evita expor outras coisas da pasta).
const HTML = { file: 'index.html', type: 'text/html; charset=utf-8' };
const STATIC_FILES = {
  '/': HTML,
  '/index.html': HTML,
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};

/* ---------- Respostas ---------- */

function sendText(res, status, text) {
  res.writeHead(status);
  res.end(text);
}

function sendJson(res, payload) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, type) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  } catch {
    sendText(res, 404, 'not found');
  }
}

// Lê o corpo da requisição. Devolve null se passar do limite (o excedente é descartado, não guardado).
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= maxBytes) chunks.push(chunk);
    });
    req.on('end', () => resolve(size <= maxBytes ? Buffer.concat(chunks) : null));
    req.on('error', reject);
  });
}

/* ---------- Dados (data.json) ---------- */

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { apps: [], settings: {} }; // primeira execução ou arquivo ilegível
  }
}

// Grava num arquivo temporário e troca no final, para nunca deixar o data.json pela metade.
function writeData(data) {
  const tempFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));

  if (fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak'); // guarda a versão anterior
  }
  fs.renameSync(tempFile, DATA_FILE);
}

async function handleSaveData(req, res) {
  const body = await readBody(req, MAX_DATA_BYTES);
  if (!body) return sendText(res, 413, 'payload too large');

  try {
    const incoming = JSON.parse(body.toString('utf8'));
    if (!Array.isArray(incoming.apps)) throw new Error('formato inválido');

    writeData({ apps: incoming.apps, settings: incoming.settings || {} });
    res.writeHead(204);
    res.end();
  } catch {
    sendText(res, 400, 'bad request');
  }
}

/* ---------- CVs (pasta cvs/) ---------- */

// Devolve um nome de arquivo seguro (sem pastas, sem caracteres estranhos) ou null se o tipo não for aceito.
function safeCvName(rawName) {
  const name = path
    .basename(String(rawName || ''))
    .replace(/[^\p{L}\p{N}._() -]/gu, '_')
    .trim();

  return CV_TYPES[path.extname(name).toLowerCase()] ? name : null;
}

function listCvs() {
  try {
    return fs.readdirSync(CV_DIR).filter((name) => safeCvName(name) === name).sort();
  } catch {
    return []; // a pasta só é criada no primeiro envio
  }
}

// Recebe o arquivo escolhido no painel e guarda em cvs/. Reenviar o mesmo nome substitui o arquivo.
async function handleUploadCv(req, res) {
  const name = safeCvName(new URL(req.url, 'http://localhost').searchParams.get('name'));
  const body = await readBody(req, MAX_CV_BYTES);

  if (!name) return sendText(res, 415, 'tipo de arquivo não aceito');
  if (!body) return sendText(res, 413, 'arquivo muito grande');

  try {
    fs.mkdirSync(CV_DIR, { recursive: true });
    fs.writeFileSync(path.join(CV_DIR, name), body);
    sendJson(res, { name });
  } catch {
    sendText(res, 500, 'erro ao salvar');
  }
}

// Abre um CV já enviado: GET /cvs/<nome>
function handleOpenCv(res, url) {
  let name;
  try {
    name = decodeURIComponent(url.slice('/cvs/'.length));
  } catch {
    return sendText(res, 404, 'not found');
  }

  if (safeCvName(name) !== name) return sendText(res, 404, 'not found');
  sendFile(res, path.join(CV_DIR, name), CV_TYPES[path.extname(name).toLowerCase()]);
}

/* ---------- Rotas ---------- */

async function handleRequest(req, res) {
  const url = req.url.split('?')[0];
  const isGet = req.method === 'GET';
  const isPut = req.method === 'PUT';

  const staticFile = STATIC_FILES[url];
  if (staticFile) return sendFile(res, path.join(__dirname, staticFile.file), staticFile.type);

  if (url === '/api/data' && isGet) return sendJson(res, readData());
  if (url === '/api/data' && isPut) return handleSaveData(req, res);
  if (url === '/api/cvs' && isGet) return sendJson(res, listCvs());
  if (url === '/api/cv' && isPut) return handleUploadCv(req, res);
  if (url.startsWith('/cvs/') && isGet) return handleOpenCv(res, url);

  sendText(res, 404, 'not found');
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(() => {
    if (!res.headersSent) sendText(res, 500, 'erro interno');
    else res.end();
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`A porta ${PORT} já está em uso. Feche o painel que já está aberto ou use outra: PORT=4000 node server.js`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Painel rodando em http://localhost:${PORT}`);
});
