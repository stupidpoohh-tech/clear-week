/*
 * Clear Week 서버 — 올리고, 합쳐진 것을 받는다.
 *
 * **합치기 규칙은 서버 한 곳에만 있다** (`functions/_lib.js`). 여기서 합치지
 * 않는다 — 두 곳에 두면 갈라지고, 갈라지면 무엇이 맞는지 아무도 모른다
 * (HANDOFF §5 규칙 4). 그래서 이 파일에는 판단이 없다: 보내고 받는 것뿐이다.
 *
 * **올리는 중에 고친 것은 응답에 덮이지 않는다.** 보낼 때의 rev를 적어 두고,
 * 돌아왔을 때 rev가 올라 있으면 그 응답은 낡은 것이라 버린다. 웹에서
 * 연달아 그을 때 두 번째부터 사라지던 원인이 이것이었다 (spec §11).
 */
import { idToken, logout } from './auth.js';
import { SERVER } from './config.js';

async function call(path, options = {}) {
  const token = await idToken();
  const res = await fetch(SERVER + path, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + token,
    },
    body: options.body,
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error((data && data.error) || String(res.status));
    err.status = res.status;
    throw err;
  }
  return data || {};
}

/* 서버가 켜져 있는지. 없으면 로그인 줄을 아예 내놓지 않는다 (spec §13) */
export async function ready() {
  try {
    const res = await fetch(SERVER + '/api/me');
    const d = await res.json().catch(() => ({}));
    return !!d.ready;
  } catch (e) { return false; }
}

/* 지금 보는 주 하나. 올리기와 받기를 나누면 그 사이에 갈라진다 — 한 번에 한다 */
export const pushWeek = (week, resetAt) => call('/api/sync', {
  method: 'POST',
  body: JSON.stringify({ weekId: week.weekId, week, resetAt }),
});

/* 기기를 새로 이을 때 — 가진 것을 전부 올리고 전부 받는다.
   **이 길에는 rev 방패가 없다.** 덮어쓰는 것이 목적이기 때문이다 (spec §11). */
export const syncAll = (weeks, resetAt) => call('/api/sync/all', {
  method: 'POST',
  body: JSON.stringify({ weeks, resetAt }),
});

/* 합치기 전에 서버에 무엇이 있는지 보기만 한다 — 물어보려면 필요하다 */
export const peek = () => call('/api/sync/all', { method: 'GET' });

/* 전부 비우기. 비운 시각이 남아 오래된 기기가 올리는 것을 막는다 */
export const wipe = () => call('/api/reset', { method: 'POST' });

export { logout };
