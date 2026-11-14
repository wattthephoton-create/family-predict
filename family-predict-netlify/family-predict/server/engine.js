import crypto from 'node:crypto';

export const START = 1000;
export const CATS = ['Family', 'Sports', 'Weather', 'School', 'Food', 'Fun'];
export const RESOLVERS = ['admin', 'proposer', 'vote'];
const MAX_OPTS = 6;

export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

/* ---------- LMSR market maker for N options ----------
   qv[i] = shares outstanding for option i. Cost C(qv) = b * ln(sum exp(qv_i / b)).
   The house's worst-case loss is b * ln(N), so b = seed / ln(N) means the house
   risks exactly the seed money (default $10), split evenly across the options. */
const Cn = (qv, b) => { const m = Math.max(...qv); return m + b * Math.log(qv.reduce((a, x) => a + Math.exp((x - m) / b), 0)); };
export const prices = (m) => {
  const mx = Math.max(...m.qv);
  const e = m.qv.map((x) => Math.exp((x - mx) / m.b));
  const t = e.reduce((a, x) => a + x, 0);
  return e.map((x) => x / t);
};
export function sharesForSpend(m, i, x) {
  const mx = Math.max(...m.qv);
  const K = Cn(m.qv, m.b) + x - mx;
  let rest = 0;
  m.qv.forEach((v, j) => { if (j !== i) rest += Math.exp((v - mx) / m.b); });
  return m.b * Math.log(Math.exp(K / m.b) - rest) + mx - m.qv[i];
}
export function proceedsForSale(m, i, s) {
  const q2 = m.qv.slice(); q2[i] -= s;
  return Cn(m.qv, m.b) - Cn(q2, m.b);
}

const uid = () => crypto.randomBytes(5).toString('hex');
export const newState = () => ({ users: {}, pos: {}, markets: [], proposals: [] });

/** What a browser may see. Strips PIN hashes, tokens and other people's votes/proposals. */
export function publicState(s, key, tokenStr) {
  const viewer = s.users[key];
  const authed = !!(viewer && typeof tokenStr === 'string' && (viewer.tokens || []).includes(tokenStr));
  const isAdmin = authed && !!viewer.admin;
  const users = {};
  for (const [k, u] of Object.entries(s.users)) users[k] = { name: u.name, bal: u.bal, pin: true, admin: !!u.admin };
  const markets = s.markets.map((m) => {
    const { votes, ...rest } = m;
    const out = { ...rest, nv: Object.keys(votes || {}).length };
    if (authed && votes && votes[key] !== undefined) out.myv = votes[key];
    if (m.status === 'resolved' && m.resolver === 'vote') {
      out.tally = m.opts.map((_, i) => Object.values(votes || {}).filter((v) => v === i).length);
    }
    return out;
  });
  const proposals = (s.proposals || []).filter((p) => isAdmin || (authed && p.by === key));
  return { users, pos: s.pos, markets, proposals, adminReady: !!process.env.ADMIN_CODE };
}

/* ---------- helpers ---------- */
const hashPin = (k, p) => crypto.createHash('sha256').update(`${k}:${p}`).digest('hex');
const newToken = (u) => { const t = crypto.randomBytes(18).toString('hex'); u.tokens = [...(u.tokens || []), t].slice(-8); return t; };
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
const cleanText = (n, max) => String(n || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);
function checkName(s, n, except) {
  if (n.length < 2) throw new HttpError(400, 'Name needs at least 2 characters');
  for (const [k, u] of Object.entries(s.users))
    if (k !== except && u.name.toLowerCase() === n.toLowerCase()) throw new HttpError(400, 'That name is already taken');
}
const checkPin = (p) => { if (!/^\d{4,8}$/.test(String(p))) throw new HttpError(400, 'PIN must be 4-8 digits'); };
function auth(s, b) {
  const u = s.users[b.key];
  if (!u || typeof b.token !== 'string' || !(u.tokens || []).includes(b.token)) throw new HttpError(401, 'Please sign in again');
  return u;
}
function requireAdmin(u) { if (!u.admin) throw new HttpError(403, 'Only the admin can do that'); }
function cleanOpts(raw) {
  let arr = Array.isArray(raw) ? raw : ['Yes', 'No'];
  arr = arr.map((x) => cleanText(x, 30)).filter(Boolean);
  const seen = new Set();
  for (const x of arr) {
    const l = x.toLowerCase();
    if (seen.has(l)) throw new HttpError(400, 'Options must all be different');
    seen.add(l);
  }
  if (arr.length < 2 || arr.length > MAX_OPTS) throw new HttpError(400, `Give between 2 and ${MAX_OPTS} options`);
  return arr;
}
function cleanProposal(b) {
  const q = cleanText(b.q, 200);
  if (q.length < 8) throw new HttpError(400, 'Write the question out (8+ characters)');
  return { q, desc: cleanText(b.desc, 500), cat: CATS.includes(b.cat) ? b.cat : 'Family', opts: cleanOpts(b.opts) };
}
function mkMarket({ title, desc, cat, opts }, by, resolver, seed) {
  const n = opts.length;
  const m = {
    id: uid(), title, desc, cat, by, opts, resolver, seed,
    b: seed / Math.log(n), qv: new Array(n).fill(0),
    created: Date.now(), status: 'open', result: null, vol: 0, hist: [], trades: [], votes: {},
  };
  m.hist.push({ t: Date.now(), p: prices(m).map((x) => Math.round(x * 1000) / 10) });
  return m;
}
function cleanProposalFields(b) {
  const title = cleanText(b.q, 200);
  if (title.length < 8) throw new HttpError(400, 'Write the question out (8+ characters)');
  return { title, desc: cleanText(b.desc, 500), cat: CATS.includes(b.cat) ? b.cat : 'Family', opts: cleanOpts(b.opts) };
}
function adminSettings(b) {
  const resolver = RESOLVERS.includes(b.resolver) ? b.resolver : 'admin';
  let seed = Number(b.seed); if (!Number.isFinite(seed)) seed = 10;
  seed = Math.min(100, Math.max(1, seed));
  return { resolver, seed };
}
function position(s, key, m) {
  s.pos[key] = s.pos[key] || {};
  const p = (s.pos[key][m.id] = s.pos[key][m.id] || { sh: [], cost: 0 });
  while (p.sh.length < m.opts.length) p.sh.push(0);
  return p;
}
function record(m, key, dir, opt, shares, amt) {
  m.hist.push({ t: Date.now(), p: prices(m).map((x) => Math.round(x * 1000) / 10) });
  m.trades.push({ t: Date.now(), u: key, dir, opt, s: shares, amt });
  if (m.hist.length > 1500) m.hist.splice(1, m.hist.length - 1500);
  if (m.trades.length > 200) m.trades.shift();
}
function settle(s, m, result) {
  for (const [k, user] of Object.entries(s.users)) {
    const p = (s.pos[k] || {})[m.id];
    if (!p) continue;
    user.bal += result === 'void' ? Math.max(0, p.cost) : (p.sh[result] || 0);
  }
  m.status = 'resolved'; m.result = result;
  const last = m.hist[m.hist.length - 1].p;
  m.hist.push({ t: Date.now(), p: result === 'void' ? last : m.opts.map((_, i) => (i === result ? 100 : 0)) });
}
const timingSafe = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/* ---------- actions ---------- */
export function act(s, b) {
  const a = b.action;
  s.proposals = s.proposals || [];

  if (a === 'signup') {
    const n = cleanName(b.name); checkName(s, n); checkPin(b.pin);
    if (Object.keys(s.users).length >= 40) throw new HttpError(400, 'Too many players');
    const k = uid();
    s.users[k] = { name: n, bal: START, pin: hashPin(k, b.pin), tokens: [] };
    return { status: 200, body: { key: k, token: newToken(s.users[k]) } };
  }

  if (a === 'login') {
    const u = s.users[b.key];
    if (!u) throw new HttpError(404, 'No such player');
    if (u.lockUntil && u.lockUntil > Date.now()) return { status: 429, body: { error: 'Too many wrong tries. Wait a minute and try again.' } };
    if (u.pin !== hashPin(b.key, String(b.pin || ''))) {
      u.fails = (u.fails || 0) + 1;
      if (u.fails >= 5) { u.lockUntil = Date.now() + 60000; u.fails = 0; }
      return { status: 403, body: { error: 'Wrong PIN' } };
    }
    u.fails = 0;
    return { status: 200, body: { key: b.key, token: newToken(u) } };
  }

  const u = auth(s, b);
  const key = b.key;

  if (a === 'account') {
    const n = cleanName(b.name); checkName(s, n, key);
    u.name = n;
    if (b.pin) { checkPin(b.pin); u.pin = hashPin(key, b.pin); }
    return { status: 200, body: {} };
  }

  if (a === 'adminUnlock') {
    const code = process.env.ADMIN_CODE;
    if (!code) throw new HttpError(400, 'The admin code has not been set up in Netlify yet. See the README.');
    if (u.aLock && u.aLock > Date.now()) return { status: 429, body: { error: 'Too many wrong tries. Wait a minute.' } };
    if (!timingSafe(b.code || '', code)) {
      u.aFails = (u.aFails || 0) + 1;
      if (u.aFails >= 5) { u.aLock = Date.now() + 60000; u.aFails = 0; }
      return { status: 403, body: { error: 'Wrong admin code' } };
    }
    u.aFails = 0; u.admin = true;
    return { status: 200, body: {} };
  }

  if (a === 'propose') {
    const f = cleanProposalFields(b);
    const mine = s.proposals.filter((p) => p.by === key && p.status === 'pending').length;
    if (mine >= 5) throw new HttpError(400, 'You already have 5 proposals waiting. Wait for the admin to review them.');
    s.proposals.push({ id: uid(), by: key, ...f, created: Date.now(), status: 'pending' });
    if (s.proposals.length > 200) s.proposals.shift();
    return { status: 200, body: {} };
  }

  if (a === 'review') {
    requireAdmin(u);
    const p = s.proposals.find((x) => x.id === b.pid);
    if (!p || p.status !== 'pending') throw new HttpError(404, 'That proposal is not waiting for review');
    if (b.decision === 'reject') {
      p.status = 'rejected'; p.note = cleanText(b.note, 200); p.reviewed = Date.now();
      return { status: 200, body: {} };
    }
    if (s.markets.length >= 300) throw new HttpError(400, 'Too many markets');
    const f = cleanProposalFields({ q: b.q ?? p.title, desc: b.desc ?? p.desc, cat: b.cat ?? p.cat, opts: b.opts ?? p.opts });
    const { resolver, seed } = adminSettings(b);
    const m = mkMarket(f, p.by, resolver, seed);
    s.markets.unshift(m);
    p.status = 'approved'; p.mid = m.id; p.reviewed = Date.now();
    return { status: 200, body: { mid: m.id } };
  }

  if (a === 'create') {
    requireAdmin(u);
    if (s.markets.length >= 300) throw new HttpError(400, 'Too many markets');
    const f = cleanProposalFields(b); const { resolver, seed } = adminSettings(b);
    const m = mkMarket(f, key, resolver, seed);
    s.markets.unshift(m);
    return { status: 200, body: { mid: m.id } };
  }

  const m = s.markets.find((x) => x.id === b.mid);
  if (!m) throw new HttpError(404, 'Market not found');
  const optIdx = Number(b.opt);
  const needOpt = () => { if (!Number.isInteger(optIdx) || optIdx < 0 || optIdx >= m.opts.length) throw new HttpError(400, 'Pick an option'); return optIdx; };

  if (a === 'buy') {
    if (m.status !== 'open') throw new HttpError(400, 'Betting is closed on this market');
    const i = needOpt();
    const amt = Math.round(Number(b.amt) * 100) / 100;
    if (!Number.isFinite(amt) || amt <= 0) throw new HttpError(400, 'Enter an amount');
    if (amt > u.bal + 1e-9) throw new HttpError(400, 'Not enough balance');
    const sh = sharesForSpend(m, i, amt);
    if (!Number.isFinite(sh) || !(sh > 0)) throw new HttpError(400, 'Amount too small');
    m.qv[i] += sh; u.bal = Math.max(0, u.bal - amt); m.vol += amt;
    const p = position(s, key, m); p.sh[i] += sh; p.cost += amt;
    record(m, key, 'bought', i, sh, amt);
    return { status: 200, body: { shares: sh } };
  }

  if (a === 'sell') {
    if (m.status !== 'open') throw new HttpError(400, 'Betting is closed on this market');
    const i = needOpt();
    const p = position(s, key, m);
    let sh = Number(b.shares);
    if (!Number.isFinite(sh) || sh <= 0) throw new HttpError(400, 'Enter shares to sell');
    if (sh > p.sh[i] - 1e-9) sh = p.sh[i];
    if (!(sh > 0)) throw new HttpError(400, 'No shares to sell');
    const got = proceedsForSale(m, i, sh);
    m.qv[i] -= sh; u.bal += got; p.sh[i] -= sh; p.cost -= got; m.vol += got;
    record(m, key, 'sold', i, sh, got);
    return { status: 200, body: { got } };
  }

  if (a === 'startVote') {
    requireAdmin(u);
    if (m.resolver !== 'vote') throw new HttpError(400, 'This market is not decided by a vote');
    if (m.status !== 'open') throw new HttpError(400, 'Voting can only start on an open market');
    m.status = 'voting';
    return { status: 200, body: {} };
  }

  if (a === 'vote') {
    if (m.status !== 'voting') throw new HttpError(400, 'Voting is not open on this market');
    m.votes = m.votes || {};
    m.votes[key] = needOpt();
    return { status: 200, body: {} };
  }

  if (a === 'finalize') {
    requireAdmin(u);
    if (m.status !== 'voting') throw new HttpError(400, 'Voting is not open on this market');
    const counts = m.opts.map((_, i) => Object.values(m.votes || {}).filter((v) => v === i).length);
    const top = Math.max(...counts);
    if (top === 0) throw new HttpError(400, 'Nobody has voted yet');
    const winners = counts.map((c, i) => (c === top ? i : -1)).filter((i) => i >= 0);
    if (winners.length > 1) throw new HttpError(400, `It's a tie between ${winners.map((i) => m.opts[i]).join(' and ')}. Ask someone to change their vote, or resolve it yourself.`);
    settle(s, m, winners[0]);
    return { status: 200, body: {} };
  }

  if (a === 'resolve') {
    if (m.status === 'resolved') throw new HttpError(400, 'Already resolved');
    const allowed = u.admin || (m.resolver === 'proposer' && m.by === key);
    if (!allowed) throw new HttpError(403, 'You cannot resolve this market');
    if (b.result === 'void') { settle(s, m, 'void'); return { status: 200, body: {} }; }
    const i = Number(b.result);
    if (!Number.isInteger(i) || i < 0 || i >= m.opts.length) throw new HttpError(400, 'Pick the winning option');
    settle(s, m, i);
    return { status: 200, body: {} };
  }

  throw new HttpError(400, 'Unknown action');
}
