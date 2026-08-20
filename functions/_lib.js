/*
 * Clear Week — 서버 공통 (Cloudflare Pages Functions)
 *
 * 이 앱은 원래 서버가 없었다. 폰과 PC를 오가며 쓰려니 필요해졌다 (spec §11).
 * 서버는 두 가지만 한다 — 누구인지 확인하고, 주를 합쳐서 돌려준다.
 * 판단은 전부 여기 한 곳에 둔다. 클라이언트는 합치지 않는다.
 */

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'free'];
export const WEEK_ID_RE = /^\d{4}-W\d{2}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SESSION_COOKIE = 'cw_session';
export const SESSION_DAYS = 90;
export const CODE_TTL_SEC = 600;      // 코드는 10분
export const CODE_TRIES = 5;          // 틀릴 수 있는 횟수
export const GRAVE_DAYS = 60;         // 지운 표시를 이만큼 보관한다

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

export function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

/* 6자리 코드. 편향 없이 뽑는다 */
export function sixDigitCode() {
  const a = new Uint32Array(1);
  do { crypto.getRandomValues(a); } while (a[0] >= 4294000000);
  return String(a[0] % 1000000).padStart(6, '0');
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

/* 길이가 같은 문자열을 시간차 없이 비교한다 */
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const normalizeEmail = v => String(v || '').trim().toLowerCase();

export function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export const setCookie = (value, maxAge) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export async function sessionEmail(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{48,}$/.test(token)) return null;
  return await env.CLEARWEEK.get('session:' + token);
}

/* 이 앱은 기획자 본인이 쓰는 물건이다. 허용 목록이 없으면 열지 않는다 —
   없으면 아무 주소로나 코드 메일을 쏠 수 있는 통로가 된다. */
export function allowedEmail(env, email) {
  const list = String(env.ALLOWED_EMAILS || '').split(',')
    .map(normalizeEmail).filter(Boolean);
  if (!list.length) return null;            // 설정 안 됨
  return list.includes(email);
}

/* ── 주 데이터 ─────────────────────────────────────────────── */

export function blankWeek(weekId) {
  const days = {}, notes = {}, noteAt = {};
  DAY_KEYS.forEach(k => { days[k] = []; notes[k] = ''; noteAt[k] = 0; });
  return { weekId, days, notes, noteAt, graves: {} };
}

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
      strikes: Array.isArray(it && it.strikes) ? it.strikes.slice(0, 40).map(s => ({
        line: Number(s && s.line) || 0,
        a: Number(s && s.a) || 0,
        b: Number(s && s.b) || 0,
        seed: Number(s && s.seed) || 0,
      })) : [],
    })).filter(it => it.id);
    w.notes[k] = raw.notes && typeof raw.notes[k] === 'string' ? raw.notes[k].slice(0, 200) : '';
    w.noteAt[k] = ts(raw.noteAt && raw.noteAt[k]);
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

    const an = ts(a.noteAt && a.noteAt[k]), bn = ts(b.noteAt && b.noteAt[k]);
    const win = bn > an ? b : a;
    out.notes[k] = (win.notes && win.notes[k]) || '';
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
