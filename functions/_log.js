/*
 * Clear Week — 방문자 행동로그의 문지기
 *
 * 이 앱은 사람이 적은 것을 담는다. 그래서 로그에 지켜야 할 선은 하나뿐이다:
 * **적은 것은 절대 나가지 않는다.**
 *
 * 그 선을 주석이나 조심성으로 지키지 않는다. 여기서 **화이트리스트로 막는다** —
 * 아는 이벤트 이름, 아는 detail 값, 숫자 두 개. 그 밖은 전부 버린다.
 * 클라이언트가 실수로 항목 글자를 실어 보내도 이 파일을 통과하지 못한다.
 * 규칙이 여기 한 곳에만 있는 이유다 (`_lib.js`의 합치기와 같은 원칙).
 */

/* 담아 두는 것 — 이름을 모르면 버린다 */
export const LOG_EVENTS = {
  open: '앱을 열었다',
  add: '항목을 적었다',
  edit: '항목을 고쳤다',
  strike: '그었다 (드래그, 한 줄)',
  strike2: '그었다 (더블탭 자동)',
  erase: '지웠다 (지우개)',
  del: '지웠다 (롱프레스) — 지운 항목마다 하나씩',
  del_sweep: '훑어서 지웠다 — 손짓 하나에 하나. 지워진 항목 수는 n1',
  week: '주를 옮겼다',
  today: 'today를 눌렀다',
  note: '요일 아래 메모를 적었다',
  split: '칸이 나뉘었다',
  overflow: '칸이 넘쳤다',
  guide: '첫 실행 안내',
  account: '내 계정을 열었다',
  backup: '백업',
  login: '로그인',
  save_fail: '저장이 막혔다',
};

/* 이벤트마다 허용된 detail 값. 여기 없는 값은 ''로 만든다.
   자유 문자열을 절대 받지 않는 것이 이 로그의 핵심이다. */
export const LOG_DETAILS = {
  open: ['standalone', 'browser'],
  add: ['day', 'free'],
  edit: ['day', 'free'],
  strike: ['day', 'free'],
  strike2: ['day', 'free'],
  erase: ['day', 'free'],
  del: ['day', 'free'],
  del_sweep: ['day', 'free'],
  week: ['prev', 'next'],
  note: ['set', 'clear'],
  guide: ['open', 'close', 'never', 'reopen'],
  backup: ['export', 'import', 'import-fail'],
  login: ['request', 'verify', 'fail', 'logout'],
};

export const LOG_MAX_BATCH = 40;        // 한 번에 받는 이벤트 수
const ID_RE = /^[a-z0-9]{8,32}$/;       // 기기·세션 ID 모양. 그 밖은 버린다

/* 숫자는 유한하고 상식적인 범위여야 한다. NaN·Infinity·1e300을 그대로 넣지 않는다 */
const num = (v, max) => {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.round(Math.min(Math.max(n, -max), max));
};

const id = v => (typeof v === 'string' && ID_RE.test(v) ? v : '');

/* 이벤트 하나를 통과시킬지 정한다. 통과 못 하면 null */
export function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ev = raw.ev;
  if (typeof ev !== 'string' || !Object.hasOwn(LOG_EVENTS, ev)) return null;

  const allowed = LOG_DETAILS[ev];
  const d = allowed && allowed.includes(raw.d) ? raw.d : '';

  return {
    ev,
    d,
    did: id(raw.did),
    sid: id(raw.sid),
    n1: num(raw.n1, 100000),
    n2: num(raw.n2, 100000),
    /* 기기 사정 — 26px 항목 높이와 칸 나누기를 판단하려면 화면 크기가 필요하다 */
    w: num(raw.w, 20000),
    h: num(raw.h, 20000),
    signed: raw.signed ? 1 : 0,
  };
}

export function sanitizeBatch(raw) {
  const list = raw && Array.isArray(raw.events) ? raw.events : [];
  const out = [];
  for (const e of list.slice(0, LOG_MAX_BATCH)) {
    const ok = sanitizeEvent(e);
    if (ok) out.push(ok);
  }
  return out;
}

/* 브라우저 문자열은 길고 사람마다 다르다 — 통째로 담으면 지문이 된다.
   다섯 갈래로만 줄인다. 이 앱이 알아야 할 것은 그게 전부다. */
export function platformOf(ua) {
  const s = String(ua || '');
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
  if (/Android/i.test(s)) return 'android';
  if (/Macintosh|Mac OS X/i.test(s)) return 'mac';
  if (/Windows/i.test(s)) return 'win';
  return 'other';
}

/* Analytics Engine이 받는 모양으로 옮긴다.
   blob 스무 개·double 스무 개·index 하나까지 받지만, 쓰는 만큼만 넣는다.
   index는 표본추출의 기준 — 이벤트 이름으로 두면 드문 이벤트가 살아남는다. */
export function toDataPoint(e, ctx = {}) {
  return {
    indexes: [e.ev],
    blobs: [
      e.ev,
      e.did,
      e.sid,
      e.d,
      String(e.signed),
      ctx.country || 'xx',
      ctx.platform || 'other',
    ],
    doubles: [1, e.n1, e.n2, e.w, e.h],
  };
}
