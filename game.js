// chessVill-4 War Edition: server-authoritative game. Rules follow the approved rule sheet.
'use strict';
const crypto = require('crypto');
const E = require('./engine.js')(4);
const SEATS = 9, HAND = 4, CLOCK_MS = 15 * 60 * 1000, GRACE_MS = 30 * 1000, EMPTY_MS = 2 * 60 * 1000;

const rnd = () => crypto.randomInt(0, 1 << 30) / (1 << 30);
const pick = (a) => a[Math.floor(rnd() * a.length)];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function perms(a) {
  if (a.length <= 1) return [a];
  const out = [];
  a.forEach((x, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).forEach((p) => out.push([x].concat(p))));
  return out;
}

const TARGET = 3;
function createGame(code, hostName, token, opts) {
  opts = opts || {};
  const g = {
    code, uid: 0, seats: [], log: [], rev: 0, created: Date.now(), scores: new Array(SEATS).fill(0), gameNo: 0, champion: null,
    clockMs: opts.clockMs || CLOCK_MS, test: !!opts.test, noHumanSince: 0,
    botPause: opts.botPause || [2000, 4000], spot: opts.spot == null ? 0.15 : opts.spot, level: opts.level === 'normal' ? 'normal' : 'pro'
  };
  for (let i = 0; i < SEATS; i++) {
    g.seats.push({ i, name: i === 0 ? hostName : 'Bot ' + i, human: i === 0, token: i === 0 ? token : null, conn: null,
      hand: [], clock: g.clockMs, out: false, announced: null, discAt: 0 });
  }
  deal(g);
  return g;
}
function deal(g) {
  const deck = shuffle(E.allCards());
  const kingId = deck.filter((c) => c[0] === 'K')[0];
  deck.splice(deck.indexOf(kingId), 1);
  g.deck = deck; g.spare = E.spareList(); g.king = { id: kingId, spare: false }; g.cast = [];
  g.over = false; g.winner = null; g.gameNo++; g.log = []; g.lastTick = Date.now(); g.botAt = 0; g.turn = 0;
  g.seats.forEach((s) => { s.hand = []; s.clock = g.clockMs; s.out = false; s.announced = null; for (let k = 0; k < HAND; k++) s.hand.push(mk(g, g.deck.shift(), false)); });
  log(g, 'Game ' + g.gameNo + '. The king stands on ' + E.sqName(E.parse(kingId).sq) + ' (' + kingId + '). ' + g.seats[0].name + ' moves first.');
  startTurn(g);
}
function award(g, si) {
  g.scores[si]++;
  if (g.scores[si] >= TARGET) { g.champion = { seat: si, name: g.seats[si].name, score: g.scores[si] }; log(g, g.seats[si].name + ' has won ' + TARGET + ' games and wins the tournament!'); }
}
function nextGame(g, si) {
  const s = g.seats[si];
  if (!s || !s.human) return 'Only a human player can start the next game.';
  if (!g.over) return 'The game is still on.';
  if (g.champion) { g.scores.fill(0); g.champion = null; g.gameNo = 0; }
  g.noHumanSince = 0; delete g.endedAt;
  deal(g); return null;
}
function mk(g, id, spare) { return { id, spare: !!spare, uid: ++g.uid }; }
function log(g, t) { g.log.push(t); if (g.log.length > 120) g.log.shift(); }
function release(g, c) { if (c.spare) g.spare.push(c.id); else g.deck.push(c.id); }
function draw(g, s) { if (g.deck.length) s.hand.push(mk(g, g.deck.shift(), false)); }
function kingSq(g) { return E.parse(g.king.id).sq; }
const alive = (g) => g.seats.filter((s) => !s.out);

function startTurn(g) {
  g.lastTick = Date.now();
  const s = g.seats[g.turn];
  g.botAt = s.human ? 0 : Date.now() + g.botPause[0] + rnd() * (g.botPause[1] - g.botPause[0]);
}
function endTurn(g) {
  const live = alive(g);
  if (live.length === 1) {
    g.over = true; g.winner = { seat: live[0].i, name: live[0].name, last: true };
    log(g, live[0].name + ' is the last seat standing and wins the game.'); award(g, live[0].i);
    return;
  }
  if (!g.test && !live.some((s) => s.human)) { g.over = true; g.winner = null; log(g, 'No human players are left, so the game ends.'); return; }
  do { g.turn = (g.turn + 1) % SEATS; } while (g.seats[g.turn].out);
  startTurn(g);
}
function eliminate(g, s, why) {
  s.out = true; s.announced = null;
  s.hand.forEach((c) => release(g, c)); s.hand = [];
  log(g, s.name + ' ' + why + ' and is out. Their cards go to the bottom of the deck.');
}

// ---- actions ----
function swapCard(g, s, uid, to) {
  const c = s.hand.find((x) => x.uid === uid);
  if (!c) return 'Card not found.';
  const p = E.parse(c.id);
  if (c.spare || p.t !== 'P' || p.sq >= 4) return 'Only a pawn on rank 8 can be swapped.';
  if (!'NBRQK'.includes(to)) return 'Pick a knight, bishop, rook, queen or king.';
  const want = to + c.id[1] + '8', at = g.spare.indexOf(want);
  if (at < 0) return want + ' is not in the spare deck.';
  g.spare.splice(at, 1); g.deck.push(c.id);
  s.hand[s.hand.indexOf(c)] = mk(g, want, true);
  log(g, s.name + ' swaps ' + c.id + ' for ' + want + ' from the spare deck.');
  return null;
}
function act(g, si, m) {
  if (g.over) return 'The game is over.';
  const s = g.seats[si];
  if (!s || s.out) return 'You are out.';
  if (g.turn !== si) return 'It is not your turn.';
  const find = (u) => s.hand.find((x) => x.uid === u);
  switch (m.t) {
    case 'swap': return swapCard(g, s, m.uid, m.to);
    case 'pass': if (s.announced) return 'Reveal your announcement.'; log(g, s.name + ' passes.'); endTurn(g); return null;
    case 'discard': {
      if (s.announced) return 'Reveal your announcement.';
      const c = find(m.uid); if (!c) return 'Card not found.';
      s.hand.splice(s.hand.indexOf(c), 1); release(g, c); draw(g, s);
      log(g, s.name + ' discards and draws.'); endTurn(g); return null;
    }
    case 'cast': {
      if (s.announced) return 'Reveal your announcement.';
      const c = find(m.uid); if (!c || c.id[0] !== 'K') return 'Pick a king card.';
      s.hand.splice(s.hand.indexOf(c), 1);
      release(g, { id: g.king.id, spare: g.king.spare });
      g.king = { id: c.id, spare: c.spare }; g.cast.push(c.id); draw(g, s);
      log(g, s.name + ' casts ' + c.id + ': the king moves to ' + E.sqName(E.parse(c.id).sq) + '.'); endTurn(g); return null;
    }
    case 'announce': {
      if (s.announced) return 'You already announced.';
      const keep = Array.isArray(m.keep) ? m.keep : [];
      if (new Set(keep).size !== keep.length) return 'Duplicate cards.';
      const kept = keep.map(find);
      if (kept.some((x) => !x)) return 'Card not found.';
      if (kept.length < 2) return 'A mate needs at least 2 cards.';
      if (kept.some((x) => x.id[0] === 'K')) return 'King cards cannot be part of a mate.';
      s.hand.filter((x) => !kept.includes(x)).forEach((x) => release(g, x));
      s.hand = kept; s.announced = kept.length;
      log(g, s.name + ' announces: checkmate in ' + kept.length + '.'); endTurn(g); return null;
    }
    case 'reveal': {
      if (!s.announced) return 'You have not announced.';
      const order = Array.isArray(m.order) ? m.order : [];
      if (order.length !== s.hand.length || new Set(order).size !== order.length) return 'Order every card you hold.';
      const cards = order.map(find);
      if (cards.some((x) => !x)) return 'Card not found.';
      const seq = cards.map((x) => x.id), r = E.verify(seq, kingSq(g)), k0 = kingSq(g);
      if (r.ok) {
        g.over = true; g.winner = { seat: si, name: s.name, seq, king: k0, line: E.mateLine(seq, k0) };
        log(g, s.name + ' reveals ' + seq.join(', ') + ': CHECKMATE. ' + s.name + ' wins the game!'); award(g, si); return null;
      }
      log(g, s.name + ' reveals ' + seq.join(', ') + ' and it fails. ' + r.why);
      s.announced = null; while (s.hand.length < HAND && g.deck.length) draw(g, s);
      endTurn(g); return null;
    }
  }
  return 'Unknown action.';
}

// ---- clocks, bots, disconnects ----
function tick(g, now) {
  now = now || Date.now();
  if (g.over) return false;
  let changed = false;
  const dt = Math.max(0, now - g.lastTick); g.lastTick = now;
  // human disconnect grace
  g.seats.forEach((s) => {
    if (s.human && !s.out && !s.conn) {
      if (!s.discAt) s.discAt = now;
      else if (now - s.discAt > GRACE_MS) {
        s.human = false; s.token = null; s.discAt = 0; changed = true;
        log(g, s.name + ' lost connection. A bot now plays this seat.');
        if (g.turn === s.i) startTurn(g);
      }
    } else s.discAt = 0;
  });
  if (!g.test && !g.seats.some((s) => s.human && !s.out)) {
    if (!g.noHumanSince) g.noHumanSince = now;
    else if (now - g.noHumanSince > EMPTY_MS) { g.over = true; log(g, 'No human has been present for 2 minutes. The game ends.'); return true; }
  } else g.noHumanSince = 0;
  const s = g.seats[g.turn];
  s.clock -= dt;
  if (s.clock <= 0) { s.clock = 0; eliminate(g, s, 'ran out of time'); endTurn(g); return true; }
  if (!s.human && g.botAt && now >= g.botAt) { botMove(g, s); changed = true; }
  return changed;
}
function botMove(g, s) {
  if (g.level === 'pro') return botPro(g, s);
  const ksq = kingSq(g);
  if (s.announced) {
    const ids = s.hand.map((c) => c.id);
    let best = null;
    for (const p of perms(s.hand)) { if (E.verify(p.map((c) => c.id), ksq).ok) { best = p; break; } }
    const order = (best || shuffleCopy(s.hand)).map((c) => c.uid);
    return act(g, s.i, { t: 'reveal', order, _ids: ids });
  }
  // free swaps of rank-8 pawns
  s.hand.slice().forEach((c) => {
    const p = E.parse(c.id);
    if (!c.spare && p.t === 'P' && p.sq < 4 && rnd() < 0.7) {
      const opts = 'QRBN'.split('').filter((t) => g.spare.includes(t + c.id[1] + '8'));
      if (opts.length) swapCard(g, s, c.uid, pick(opts));
    }
  });
  const movable = s.hand.filter((c) => c.id[0] !== 'K');
  if (rnd() < g.spot) for (let n = 2; n <= Math.min(4, movable.length); n++) {
    for (const sub of subsets(movable, n)) {
      for (const p of perms(sub)) {
        if (E.verify(p.map((c) => c.id), ksq).ok) return act(g, s.i, { t: 'announce', keep: sub.map((c) => c.uid) });
      }
    }
  }
  if (movable.length >= 2 && rnd() < 0.05) {
    const n = Math.min(movable.length, 2 + Math.floor(rnd() * 2));
    return act(g, s.i, { t: 'announce', keep: shuffleCopy(movable).slice(0, n).map((c) => c.uid) });
  }
  const kings = s.hand.filter((c) => c.id[0] === 'K');
  const threat = g.seats.some((o) => o !== s && !o.out && o.announced);
  if (kings.length && ((threat && rnd() < 0.6) || (!threat && rnd() < 0.15))) return act(g, s.i, { t: 'cast', uid: pick(kings).uid });
  const score = (c) => {
    const p = E.parse(c.id);
    if (p.t === 'K') return kings.length > 1 ? 1 : 4;
    if (p.t === 'P') return 1;
    return 3;
  };
  const lo = Math.min.apply(null, s.hand.map(score));
  return act(g, s.i, { t: 'discard', uid: pick(s.hand.filter((c) => score(c) === lo)).uid });
}

// ---------- Professional bots ----------
// They use the same information a player has: their own hand, the face-up top card, the king square,
// the cast cards and the announcements. They search every mate, pick the one that survives the most
// king squares, defend with the hardest-to-mate king card, and plan discards by how many unseen cards
// would complete a mate.
const orderCache = new Map();
function findOrder(ids, ksq) {
  const key = ids.slice().sort().join(',') + '@' + ksq;
  if (orderCache.has(key)) return orderCache.get(key);
  let res = null;
  for (const p of perms(ids)) { if (E.verify(p, ksq).ok) { res = p; break; } }
  if (orderCache.size > 300000) orderCache.clear();
  orderCache.set(key, res);
  return res;
}
function mateSubsets(ids, ksq, all) {
  const out = [];
  for (let n = 2; n <= Math.min(4, ids.length); n++) {
    for (const sub of subsets(ids, n)) {
      const o = findOrder(sub, ksq);
      if (o) { out.push({ sub, order: o }); if (!all) return out; }
    }
  }
  return out;
}
function robust(sub, ksq) { let n = 0; for (let k = 0; k < 16; k++) if (k !== ksq && findOrder(sub, k)) n++; return n; }
function mobility(sqi) { const x = sqi % 4, y = (sqi / 4) | 0; let n = 0; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { if ((dx || dy) && x + dx >= 0 && x + dx < 4 && y + dy >= 0 && y + dy < 4) n++; } return n; }
function potential(ids, ksq, sample) {
  let hit = 0;
  for (const x of sample) { if (mateSubsets(ids.concat([x]), ksq, false).length) hit++; }
  return hit / sample.length * 100;
}
function botPro(g, s) {
  const ksq = kingSq(g), nonK = () => s.hand.filter((c) => c.id[0] !== 'K');
  const ids = () => nonK().map((c) => c.id);
  // 1. reveal, repairing with a swap if the defenders broke the mate
  if (s.announced) {
    let o = findOrder(s.hand.map((c) => c.id), ksq);
    if (!o) {
      outer: for (const c of s.hand.slice()) {
        const p = E.parse(c.id);
        if (c.spare || p.t !== 'P' || p.sq >= 4) continue;
        for (const t of 'QRBN') {
          if (!g.spare.includes(t + c.id[1] + '8')) continue;
          const trial = s.hand.map((x) => (x === c ? t + c.id[1] + '8' : x.id));
          if (findOrder(trial, ksq)) { swapCard(g, s, c.uid, t); break outer; }
        }
      }
      o = findOrder(s.hand.map((c) => c.id), ksq);
    }
    const order = (o ? o.map((id) => s.hand.find((c) => c.id === id)) : shuffleCopy(s.hand)).map((c) => c.uid);
    return act(g, s.i, { t: 'reveal', order });
  }
  const known = new Set(s.hand.map((c) => c.id).concat(g.cast, [g.king.id], g.top ? [] : []));
  const unseen = E.allCards().filter((id) => id[0] !== 'K' && !known.has(id) && id !== g.deck[0]);
  const sample = shuffleCopy(unseen).slice(0, 24);
  const topId = g.deck[0] || null;
  // 2. free swaps that raise the hand's chances
  const handScore = (h) => (mateSubsets(h, ksq, false).length ? 1000 : potential(h, ksq, sample));
  for (let guard = 0; guard < 3; guard++) {
    let base = handScore(ids()), best = null;
    for (const c of s.hand) {
      const p = E.parse(c.id);
      if (c.spare || p.t !== 'P' || p.sq >= 4) continue;
      for (const t of 'QRBN') {
        if (!g.spare.includes(t + c.id[1] + '8')) continue;
        const sc = handScore(ids().filter((id) => id !== c.id).concat([t + c.id[1] + '8']));
        if (sc > base + 0.5 && (!best || sc > best.sc)) best = { c, t, sc };
      }
    }
    if (!best) break;
    swapCard(g, s, best.c.uid, best.t);
  }
  const threat = g.seats.some((o) => o !== s && !o.out && o.announced);
  const kings = s.hand.filter((c) => c.id[0] === 'K');
  // 3. a mate in hand: announce the sturdiest one, unless defending is needed and possible
  const mates = mateSubsets(ids(), ksq, true);
  if (mates.length && !(threat && kings.length)) {
    mates.sort((a, b) => robust(b.sub, ksq) - robust(a.sub, ksq) || a.sub.length - b.sub.length);
    const pickSub = mates[0].sub;
    return act(g, s.i, { t: 'announce', keep: pickSub.map((id) => s.hand.find((c) => c.id === id).uid) });
  }
  // 4. defend, or cast to a square where my own hand mates
  const withMate = kings.filter((k) => mateSubsets(ids(), E.parse(k.id).sq, false).length);
  if (threat && kings.length) {
    const pool = withMate.length ? withMate : kings;
    pool.sort((a, b) => mobility(E.parse(b.id).sq) - mobility(E.parse(a.id).sq));
    return act(g, s.i, { t: 'cast', uid: pool[0].uid });
  }
  if (withMate.length) {
    withMate.sort((a, b) => robust(mateSubsets(ids(), E.parse(b.id).sq, false)[0].sub, E.parse(b.id).sq) - robust(mateSubsets(ids(), E.parse(a.id).sq, false)[0].sub, E.parse(a.id).sq));
    return act(g, s.i, { t: 'cast', uid: withMate[0].uid });
  }
  // 5. discard the card that leaves the best hand once the face-up top card is drawn
  let best = null;
  s.hand.forEach((y) => {
    const rest = s.hand.filter((c) => c !== y).map((c) => c.id).concat(topId ? [topId] : []);
    const ns = rest.filter((id) => id[0] !== 'K');
    let sc = mateSubsets(ns, ksq, false).length ? 1000 : potential(ns, ksq, sample);
    const kept = rest.filter((id) => id[0] === 'K').length;
    sc += kept >= 1 ? 12 : 0; sc += kept >= 2 ? 4 : 0;
    sc += rnd() * 0.01;
    if (!best || sc > best.sc) best = { y, sc };
  });
  return act(g, s.i, { t: 'discard', uid: best.y.uid });
}

function shuffleCopy(a) { return shuffle(a.slice()); }
function subsets(a, n) {
  const out = [];
  (function go(i, cur) { if (cur.length === n) { out.push(cur.slice()); return; } for (let j = i; j < a.length; j++) { cur.push(a[j]); go(j + 1, cur); cur.pop(); } })(0, []);
  return out;
}

// ---- what each player may see ----
function view(g, si) {
  const s = g.seats[si];
  return {
    t: 'state', code: g.code, gameNo: g.gameNo, scores: g.scores.slice(), target: TARGET, champion: g.champion, rev: ++g.rev, you: si, turn: g.turn, over: g.over, winner: g.winner,
    seats: g.seats.map((x) => ({ i: x.i, name: x.name, human: x.human, out: x.out, count: x.hand.length, announced: x.announced, clock: Math.max(0, Math.round(x.clock)), live: !!x.conn })),
    top: g.deck[0] || null, deckCount: g.deck.length, king: g.king.id, cast: g.cast.slice(), spare: g.spare.slice(),
    hand: s ? s.hand.map((c) => ({ id: c.id, spare: c.spare, uid: c.uid })) : [], log: g.log.slice(-60)
  };
}
module.exports = { createGame, nextGame, act, tick, view, SEATS, HAND, E };
