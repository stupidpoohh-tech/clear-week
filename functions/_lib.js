/*
 * Clear Week — 서버 공통 (Cloudflare Pages Functions)
 *
 * 이 앱은 원래 서버가 없었다. 폰과 PC를 오가며 쓰려니 필요해졌다 (spec §11).
 * 서버는 두 가지만 한다 — 누구인지 확인하고, 주를 합쳐서 돌려준다.
 * 판단은 전부 여기 한 곳에 둔다. 클라이언트는 합치지 않는다.
 */

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'free'];
export const WEEK_ID_RE = /^\d{4}-W\d{2}$/;
export const GRAVE_DAYS = 60;         // 지운 표시를 이만큼 보관한다

/* Firebase 프로젝트 id. **캘린더와 같은 값**을 쓴다 — Clear Week과 캘린더가
   같은 계정을 공유하기 때문이다 (spec §11, 2026-08-24). 서버는 요청마다
   Firebase가 발급한 ID token을 검증해 email을 뽑는다. */
export const FIREBASE_PROJECT_ID = 'dada-calendar-524ec';

/* 시각은 1e12를 넘으므로 `|0`을 쓰면 안 된다 (32비트를 넘어 값이 뒤집힌다) */
export const ts = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

/* ── Firebase ID token 검증 ────────────────────────────────
   요청마다 Authorization: Bearer <idToken>이 실려 온다. 여기서 서명·발행자·
   수신자·만료를 전부 확인하고 그 안의 email을 뽑는다. Google 공개키(JWK)를
   가져와 로컬에서 검증한다 — 요청마다 Google에 되묻지 않는다.

   저장 키는 **email로 유지한다.** uid로 옮기지 않는 이유는 이관을 안 하려는
   것이다. Firebase가 email을 검증한 것이 확실하다면 email로 계속 쓴다. */

const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let jwksCache = null;

async function getJwks() {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAt > now) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  const data = await res.json();
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  const ttl = m ? Number(m[1]) * 1000 : 3600000;
  const keys = {};
  for (const k of (data.keys || [])) keys[k.kid] = k;
  jwksCache = { keys, expiresAt: now + ttl };
  return keys;
}

function b64uToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* 검증에 실패하면 null. 실패 이유를 밖으로 보내지 않는다 — 조사할 자리를
   주면 안 된다. **아이덴티티 하나만 뽑아 준다.** */
export async function firebaseEmail(request) {
  const auth = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const parts = m[1].trim().split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;

  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64uToBytes(h)));
    payload = JSON.parse(new TextDecoder().decode(b64uToBytes(p)));
  } catch (e) { return null; }

  if (header.alg !== 'RS256' || !header.kid) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) return null;
  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (payload.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID) return null;
  if (typeof payload.email !== 'string' || !payload.email_verified) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;

  const keys = await getJwks();
  const jwk = keys[header.kid];
  if (!jwk) return null;

  try {
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, b64uToBytes(sig),
      new TextEncoder().encode(h + '.' + p));
    if (!ok) return null;
  } catch (e) { return null; }

  return payload.email.toLowerCase();
}

/* 전부 비운 시각. 이보다 오래된 기기가 밀어 올리는 것은 받지 않는다 —
   받으면 방금 비운 것이 그 기기에서 되살아난다. */
export async function readResetAt(env, email) {
  return ts(Number(await env.CLEARWEEK.get('reset:' + email)));
}

/* ── 주 데이터 ─────────────────────────────────────────────── */

export function blankWeek(weekId) {
  const days = {}, notes = {}, noteAt = {}, noteStrikes = {};
  DAY_KEYS.forEach(k => {
    days[k] = []; notes[k] = ''; noteAt[k] = 0; noteStrikes[k] = [];
  });
  return { weekId, days, notes, noteAt, noteStrikes, graves: {} };
}

/* 획 하나 = 줄 번호 + 그 줄 안에서의 시작·끝 비율 + 시드. 좌표는 담지 않는다 */
const strikeList = (raw, max) => (Array.isArray(raw) ? raw.slice(0, max).map(s => ({
  line: Number(s && s.line) || 0,
  a: Number(s && s.a) || 0,
  b: Number(s && s.b) || 0,
  seed: Number(s && s.seed) || 0,
})) : []);

/* 바깥에서 들어온 것은 모양을 믿지 않는다 */
export function sanitizeWeek(raw, weekId) {
  const w = blankWeek(weekId);
  if (!raw || typeof raw !== 'object') return w;
  DAY_KEYS.forEach(k => {
    const list = raw.days && Array.isArray(raw.days[k]) ? raw.days[k] : [];
    w.days[k] = list.slice(0, 500).map(it => ({
      id: String((it && it.id) || ''),
      text: String((it && it.text) || '').slice(0, 500),
      struck: !!(it && it.struck),
      createdAt: ts(it && it.createdAt),
      updatedAt: ts(it && it.updatedAt) || ts(it && it.createdAt),
      strikes: strikeList(it && it.strikes, 40),
    })).filter(it => it.id);
    w.notes[k] = raw.notes && typeof raw.notes[k] === 'string' ? raw.notes[k].slice(0, 200) : '';
    w.noteAt[k] = ts(raw.noteAt && raw.noteAt[k]);
    /* 메모는 200자까지라 줄이 많아야 몇 개다 — 8이면 넉넉하다 */
    w.noteStrikes[k] = strikeList(raw.noteStrikes && raw.noteStrikes[k], 8);
  });
  const graves = raw.graves && typeof raw.graves === 'object' ? raw.graves : {};
  for (const id of Object.keys(graves).slice(0, 2000)) {
    const t = ts(graves[id]);
    if (t) w.graves[String(id)] = t;
  }
  return w;
}

/*
 * 두 주를 항목 단위로 합친다.
 *
 * 규칙은 하나다 — **적은 것이 없어지지 않는 쪽으로 기운다.**
 * 같은 항목은 나중에 고친 쪽을 따르고, 지운 표시(graves)보다 나중에 고쳤으면
 * 고친 쪽이 이긴다. 순서는 createdAt으로 정한다. 배열 순서를 쓰면 기기마다 달라진다.
 */
export function mergeWeek(a, b, now = Date.now()) {
  const weekId = a.weekId || b.weekId;
  const out = blankWeek(weekId);

  for (const src of [a, b]) {
    for (const id of Object.keys(src.graves || {})) {
      out.graves[id] = Math.max(out.graves[id] || 0, ts(src.graves[id]));
    }
  }

  for (const k of DAY_KEYS) {
    const byId = new Map();
    for (const src of [a, b]) {
      for (const it of (src.days && src.days[k]) || []) {
        const prev = byId.get(it.id);
        if (!prev || ts(it.updatedAt) > ts(prev.updatedAt)) byId.set(it.id, it);
      }
    }
    out.days[k] = Array.from(byId.values())
      .filter(it => !(out.graves[it.id] && out.graves[it.id] >= ts(it.updatedAt)))
      .sort((x, y) => ts(x.createdAt) - ts(y.createdAt) || String(x.id).localeCompare(String(y.id)));

    /* 메모는 글자와 획이 한 몸이다 — 나중에 고친 쪽을 통째로 따른다.
       따로 합치면 이쪽 글자에 저쪽 획이 얹혀 엉뚱한 줄이 그어진다 (spec §4-6). */
    const an = ts(a.noteAt && a.noteAt[k]), bn = ts(b.noteAt && b.noteAt[k]);
    const win = bn > an ? b : a;
    out.notes[k] = (win.notes && win.notes[k]) || '';
    out.noteStrikes[k] = strikeList(win.noteStrikes && win.noteStrikes[k], 8);
    out.noteAt[k] = Math.max(an, bn);
  }

  /* 오래된 지움 표시는 정리한다. 이보다 오래 꺼져 있던 기기에서는
     지운 항목이 되살아날 수 있다 — 그 편이 지워지는 것보다 낫다. */
  const cutoff = now - GRAVE_DAYS * 86400000;
  for (const id of Object.keys(out.graves)) {
    if (out.graves[id] < cutoff) delete out.graves[id];
  }
  out.updatedAt = now;
  return out;
}
