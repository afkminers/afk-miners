#!/usr/bin/env node
const WebSocket = require('ws');

function arg(name, def) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : def;
}

const url = arg('url', 'ws://localhost:3000/ws');
const origin = arg('origin', 'http://localhost:3000');
const bytes = Number(arg('bytes', 40 * 1024));

const ws = new WebSocket(url, { origin });

ws.on('open', () => {
  console.log(`WS open, enviando ${bytes} bytes...`);
  ws.send('x'.repeat(bytes));
});

ws.on('close', (code, reason) => {
  console.log('WS closed:', code, String(reason || ''));
  process.exit(0);
});

ws.on('error', (e) => {
  console.log('WS error:', e && e.message);
});