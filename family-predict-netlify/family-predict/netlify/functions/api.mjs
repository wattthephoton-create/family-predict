// One Netlify Function serves both /api/state and /api/act.
// Everything is saved in Netlify Blobs, which comes with every Netlify site: no separate database to set up.
import { getStore } from '@netlify/blobs';
import { act, publicState, newState, HttpError } from '../../server/engine.js';

const KEY = 'state-v2';
const LOCK = 'lock';
const store = () => getStore({ name: 'family-predict', consistency: 'strong' });
const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Only one request may change the saved state at a time, so two bets placed at the same
// moment can't overwrite each other. The lock is a blob that can only be created if absent.
async function withLock(st, fn) {
  const id = Math.random().toString(36).slice(2);
  for (let i = 0; i < 80; i++) {
    const got = await st.setJSON(LOCK, { id, t: Date.now() }, { onlyIfNew: true });
    const held = await st.get(LOCK, { type: 'json' });
    if (got.modified && held && held.id === id) { // double-check the lock really is ours
      try { return await fn(); } finally { await st.delete(LOCK); }
    }
    if (held && Date.now() - held.t > 8000) await st.delete(LOCK); // left behind by a crashed request
    else await sleep(50 + Math.random() * 100);
  }
  throw new HttpError(503, 'Busy, please try again');
}

export default async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  try {
    if (path.endsWith('/state')) {
      const s = (await store().get(KEY, { type: 'json' })) || newState();
      const key = req.headers.get('x-key') || '';
      const tok = req.headers.get('x-token') || '';
      return json(200, { state: publicState(s, key, tok), persistent: true });
    }

    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    let b;
    try { b = await req.json(); } catch { b = null; }
    if (!b || typeof b !== 'object') return json(400, { error: 'Bad request' });

    const st = store();
    return await withLock(st, async () => {
      const s = (await st.get(KEY, { type: 'json' })) || newState();
      const r = act(s, b); // throws HttpError on a bad request: nothing is saved
      await st.setJSON(KEY, s);
      const state = publicState(s, r.body.key || b.key, r.body.token || b.token);
      return json(r.status, { ...r.body, state, persistent: true });
    });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: 'Server error' });
  }
};

export const config = { path: ['/api/state', '/api/act'] };
