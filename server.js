#!/usr/bin/env node
// Card scanner example for TCG API (https://tcgapi.dev).
//
// Serves one page and forwards each photo to POST /v1/identify, so the API key
// stays on this server and never reaches the browser. Built-in modules only.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {} // .env is optional

const KEY = process.env.TCGAPI_KEY;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const API = 'https://api.tcgapi.dev/v1/identify';
const MAX_BYTES = 8 * 1024 * 1024; // the API's own limit
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

if (!KEY) {
  console.error('Set TCGAPI_KEY (in .env or the environment). Free keys: https://tcgapi.dev/signup/');
  process.exit(1);
}

const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(status === 413 && { Connection: 'close' }) });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
const fail = (res, status, message, code) => send(res, status, { error: { message, code } });

// Read the request body, stopping at the size limit instead of buffering a huge upload.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) { req.removeAllListeners('data'); reject(new Error('too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function scan(req, res, url) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!TYPES.has(type)) return fail(res, 415, 'Send a JPEG, PNG or WebP image.', 'INVALID_IMAGE');

  let image;
  try { image = await readBody(req); } catch {
    // Answer first, then drop the connection, so the client sees the 413 instead of a reset.
    res.on('finish', () => req.destroy());
    return fail(res, 413, 'The photo is larger than 8 MB.', 'INVALID_IMAGE');
  }
  if (!image.length) return fail(res, 400, 'No image received.', 'INVALID_IMAGE');

  // include=prices adds the top match's prices to the same response, at no extra charge.
  const query = new URLSearchParams({ include: 'prices' });
  const game = url.searchParams.get('game'); // optional: a slug from GET /v1/games
  if (game && /^[a-z0-9-]{1,80}$/.test(game)) query.set('game', game);

  let upstream;
  try {
    upstream = await fetch(`${API}?${query}`, {
      method: 'POST',
      headers: { 'X-API-Key': KEY, 'Content-Type': type },
      body: image,
    });
  } catch {
    return fail(res, 502, 'Could not reach api.tcgapi.dev.', 'UPSTREAM_UNREACHABLE');
  }
  // Pass the API's answer through as it is: { data, meta } or { error: { message, code } }.
  send(res, upstream.status, await upstream.text());
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page);
  }
  if (req.method === 'POST' && url.pathname === '/api/scan') {
    return scan(req, res, url).catch(() => fail(res, 500, 'Unexpected error.', 'INTERNAL'));
  }
  fail(res, 404, 'Not found.', 'NOT_FOUND');
}).listen(PORT, HOST, () => console.log(`Card scanner example: http://${HOST}:${PORT}`));
