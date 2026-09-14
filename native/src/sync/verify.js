/*
 * 메일 인증의 **판단만** 여기 있다 (P1-1).
 *
 * 보내고 물어보는 일은 `auth.js`가 한다 — 그쪽은 키체인과 네트워크를 쥐고 있어
 * 화면 없이 검사할 수 없다. 판단은 숫자와 문자열뿐이라 따로 두면 검사된다
 * (`tests/verify.mjs`). **인증 상태를 여러 곳에 흩는 것과는 다르다** —
 * 상태는 여전히 `auth.js`의 `state` 하나뿐이고, 여기 있는 것은 규칙이다.
 */
import { SYNC } from './config.js';

/* 다시 보내기까지 남은 초. 0이면 지금 보낼 수 있다 */
export function resendLeft(mailAt, now = Date.now(), waitMs = SYNC.verifyWaitMs) {
  if (!mailAt) return 0;
  return Math.max(0, Math.ceil((waitMs - (now - mailAt)) / 1000));
}

/* 지금 보내도 되나 — 처음 한 번은 언제나 보낸다 */
export function canSend({ first, busy, mailAt }, now = Date.now()) {
  if (busy) return { ok: false, reason: 'busy' };
  if (first) return { ok: true };
  const sec = resendLeft(mailAt, now);
  return sec > 0 ? { ok: false, reason: 'wait', sec } : { ok: true };
}

/*
 * 서버가 401을 줬을 때 무엇으로 볼 것인가.
 * **인증 전인 것과 로그인이 죽은 것은 다르다** — 전자를 로그아웃으로 처리하면
 * 이 기기에 적은 것과의 연결이 끊긴다.
 */
export function deniedMeans(verifiedNow) {
  if (verifiedNow === true) return 'logged-out';    // 인증은 됐는데 거절 → 토큰이 죽었다
  if (verifiedNow === false) return 'unverified';   // 아직 인증 전이다
  return 'unknown';                                 // 못 물어봤다 — 그대로 둔다
}
