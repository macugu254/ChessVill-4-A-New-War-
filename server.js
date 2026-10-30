// chessVill-4 War Edition server. Serves the game page and runs every game on the server; nothing is stored on disk.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
// Two pages sit next to this file: index.html (chessVill3) and chessvill4.html (chessVill4).
// A folder named public is also checked, so older uploads keep working.
function find(name) {
  const c = [path.join(__dirname, name), path.join(__dirname, 'public', name)].find((p) => fs.existsSync(p));
  return c ? fs.readFileSync(c) : null;
}
const WAR = find('war4.html');
const War = require('./game.js');
if (!WAR) { console.error('war4.html was not found. Upload war4.html next to server.js.'); process.exit(1); }
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url === '/' || url === '/index.html' || url === '/war' || url === '/war/' || url === '/war4.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    return res.end(WAR);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const wars = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', (req, sock, head) => {
  const u = (req.url || '').split('?')[0];
  const w = u === '/war-ws' ? wars : null;
  if (!w) { sock.destroy(); return; }
  w.handleUpgrade(req, sock, head, (ws) => w.emit('connection', ws, req));
});
// ---------- War Edition (server-authoritative) ----------
const games = new Map();
const MAX_GAMES = 200;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
function sendState(g, seat) {
  const c = seat.conn;
  if (c && c.readyState === 1) c.send(JSON.stringify(War.view(g, seat.i)));
}
function pushAll(g) { g.seats.forEach((s) => { if (s.human) sendState(g, s); }); }
function newCode() { for (;;) { const c = 'w4-' + crypto.randomBytes(4).toString('hex').slice(0, 6); if (!games.has(c)) return c; } }
function clean(n) { return String(n || '').replace(/[\u0000-\u001f\u007f<>&"']/g, '').trim().slice(0, 16) || 'Host'; }
function attach(g, seat, ws) {
  if (seat.conn && seat.conn !== ws) { try { seat.conn.close(); } catch (e) {} }
  seat.conn = ws; seat.discAt = 0; ws.warGame = g.code; ws.warSeat = seat.i;
  sendState(g, seat);
}
wars.on('connection', (ws) => {
  ws.warCount = 0; ws.warGame = null; ws.warSeat = -1; ws.warAlive = true;
  ws.on('pong', () => { ws.warAlive = true; });
  ws.on('message', (raw) => {
    if (++ws.warCount > 20) return;
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'new') {
      if (ws.warGame || typeof m.token !== 'string' || !TOKEN_RE.test(m.token)) return;
      if (games.size >= MAX_GAMES) { ws.send(JSON.stringify({ t: 'err', msg: 'The server is busy. Try again in a few minutes.' })); return; }
      const g = War.createGame(newCode(), clean(m.name), m.token, { level: m.level === 'normal' ? 'normal' : 'pro' });
      games.set(g.code, g); attach(g, g.seats[0], ws);
    } else if (m.t === 'resume') {
      const g = games.get(m.code);
      const seat = g && typeof m.token === 'string' ? g.seats.find((s) => s.human && s.token === m.token) : null;
      if (!seat) { ws.send(JSON.stringify({ t: 'gone' })); return; }
      attach(g, seat, ws); pushAll(g);
    } else if (m.t === 'act') {
      const g = games.get(ws.warGame); if (!g) return;
      const a = m.a; if (!a || typeof a !== 'object') return;
      const clone = { t: String(a.t), uid: Number(a.uid), to: String(a.to || ''), keep: Array.isArray(a.keep) ? a.keep.slice(0, 4).map(Number) : [], order: Array.isArray(a.order) ? a.order.slice(0, 4).map(Number) : [] };
      const err = War.act(g, ws.warSeat, clone);
      if (err) ws.send(JSON.stringify({ t: 'err', msg: err })); else pushAll(g);
    } else if (m.t === 'next') {
      const g = games.get(ws.warGame); if (!g) return;
      const err = War.nextGame(g, ws.warSeat);
      if (err) ws.send(JSON.stringify({ t: 'err', msg: err })); else pushAll(g);
    } else if (m.t === 'ping') ws.send('{"t":"pong"}');
  });
  const drop = () => {
    const g = games.get(ws.warGame);
    if (g) { const s = g.seats[ws.warSeat]; if (s && s.conn === ws) s.conn = null; }
    ws.warGame = null;
  };
  ws.on('close', drop); ws.on('error', drop);
});
setInterval(() => { wars.clients.forEach((c) => { c.warCount = 0; }); }, 1000);
setInterval(() => {
  const now = Date.now();
  games.forEach((g, code) => {
    const was = g.over;
    let ch = false;
    try { ch = War.tick(g, now); } catch (e) { console.error('tick', e); g.over = true; }
    if (ch || g.over !== was) pushAll(g);
    if (g.over) { if (!g.endedAt) g.endedAt = now; else if (now - g.endedAt > 600000) games.delete(code); }
  });
}, 250);
setInterval(() => { games.forEach((g) => { if (!g.over) pushAll(g); }); }, 5000);
setInterval(() => {
  wars.clients.forEach((c) => { if (!c.warAlive) return c.terminate(); c.warAlive = false; c.ping(); });
}, 30000);

server.listen(PORT, () => console.log('chessVill listening on ' + PORT));
