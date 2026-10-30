// chessVill rules engine (pure functions). Same logic as the Race pages, validated against python-chess.
'use strict';
module.exports = function makeEngine(N) {
  const FILES = ['h', 'g', 'f', 'e'].slice(0, N), RANKS = [8, 7, 6, 5].slice(0, N);
  const sqName = (i) => FILES[i % N] + RANKS[Math.floor(i / N)];
  const parse = (id) => ({ t: id[0], sq: RANKS.indexOf(Number(id[2])) * N + FILES.indexOf(id[1]) });
  function allCards() {
    const out = [];
    'PNBRQK'.split('').forEach((t) => FILES.forEach((f) => RANKS.forEach((r) => out.push(t + f + r))));
    return out;
  }
  function spareList() {
    const out = [];
    'NBRQK'.split('').forEach((t) => FILES.forEach((f) => out.push(t + f + '8')));
    return out;
  }
  function attackedSet(p) {
    const s = new Set();
    for (let i = 0; i < N * N; i++) {
      const t = p[i]; if (!t) continue;
      const x = i % N, y = (i / N) | 0;
      const add = (nx, ny) => { if (nx >= 0 && nx < N && ny >= 0 && ny < N) s.add(ny * N + nx); };
      if (t === 'P') { add(x - 1, y - 1); add(x + 1, y - 1); }
      else if (t === 'N') { [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]].forEach((d) => add(x + d[0], y + d[1])); }
      else {
        const dirs = [];
        if (t === 'B' || t === 'Q') dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
        if (t === 'R' || t === 'Q') dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
        dirs.forEach((d) => {
          let nx = x + d[0], ny = y + d[1];
          while (nx >= 0 && nx < N && ny >= 0 && ny < N) {
            const k = ny * N + nx; s.add(k); if (p[k]) break; nx += d[0]; ny += d[1];
          }
        });
      }
    }
    return s;
  }
  function kingMoves(k, p) {
    const out = [], kx = k % N, ky = (k / N) | 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = kx + dx, ny = ky + dy;
      if (nx < 0 || nx > N - 1 || ny < 0 || ny > N - 1) continue;
      const d = ny * N + nx, np = p.slice(), cap = !!p[d];
      np[d] = null;
      if (!attackedSet(np).has(d)) out.push({ to: d, cap, np });
    }
    return out;
  }
  const describe = (o) => (o.stay ? 'stays put' : (o.cap ? 'Kx' : 'K') + sqName(o.to));
  function verify(seq, k0) {
    function rec(i, k, p) {
      const c = parse(seq[i]);
      if (c.t === 'K') return { ok: false, why: seq[i] + ' is a king card and cannot be placed.' };
      if (c.sq === k) return { ok: false, why: seq[i] + ' cannot be placed because the king stands on ' + sqName(k) + '.' };
      if (p[c.sq]) return { ok: false, why: seq[i] + ' cannot be placed because ' + sqName(c.sq) + ' is taken.' };
      const np = p.slice(); np[c.sq] = c.t;
      const check = attackedSet(np).has(k), moves = kingMoves(k, np);
      if (check && moves.length === 0) return { ok: true, at: i };
      if (i === seq.length - 1) {
        return { ok: false, why: check
          ? seq[i] + ' gives check but the king can go to ' + moves.map((m) => sqName(m.to)).join(' or ') + '.'
          : seq[i] + ' does not give check, so it is not mate.' };
      }
      const opts = check ? moves : [{ stay: true, to: k, np }].concat(moves.filter((m) => m.cap));
      let worst = { ok: true, at: 0 };
      for (const o of opts) {
        const r = rec(i + 1, o.to, o.np);
        if (!r.ok) return { ok: false, why: 'After ' + seq[i] + (check ? '+' : '') + ' the king ' + (o.stay ? 'stays put' : 'plays ' + describe(o)) + '. ' + r.why };
        if (r.at > worst.at) worst = r;
      }
      return worst;
    }
    return rec(0, k0, new Array(N * N).fill(null));
  }
  // The mate as it would be played: after each card, where the king can go. The king's longest resistance is shown.
  function mateLine(seq, k0) {
    function rec(i, k, p) {
      const c = parse(seq[i]), np = p.slice(); np[c.sq] = c.t;
      const check = attackedSet(np).has(k), moves = kingMoves(k, np);
      const step = { card: seq[i], place: np.slice(), king: k, check };
      if (check && moves.length === 0) { step.mate = true; return [step]; }
      if (i === seq.length - 1) return null;
      const opts = check ? moves : [{ stay: true, to: k, np }].concat(moves.filter((m) => m.cap));
      let best = null, bo = null;
      for (const o of opts) {
        const r = rec(i + 1, o.to, o.np);
        if (!r) return null;
        if (!best || r.length > best.length) { best = r; bo = o; }
      }
      step.reply = { to: bo.to, cap: !!bo.cap, stay: !!bo.stay, text: bo.stay ? 'stays put' : (bo.cap ? 'captures on ' : 'moves to ') + sqName(bo.to) };
      step.after = bo.np.slice(); step.kingAfter = bo.to;
      return [step].concat(best);
    }
    return rec(0, k0, new Array(N * N).fill(null));
  }
  return { N, mateLine, FILES, RANKS, sqName, parse, allCards, spareList, verify };
};
