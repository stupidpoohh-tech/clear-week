/*
 * 메일 인증의 규칙 (P1-1) — 네이티브도 웹과 같은 선을 지킨다.
 * 보내고 물어보는 일은 기기에서만 되지만, **언제 보내도 되는가**와
 * **401을 무엇으로 읽는가**는 여기서 검사한다.
 */
import { check, ok, done } from './_harness.mjs';
import { resendLeft, canSend, deniedMeans } from '../src/sync/verify.js';
import { SYNC } from '../src/sync/config.js';

const NOW = 1_800_000_000_000;

console.log('\n── 다시 보내기까지 ──');
check('보낸 적이 없으면 지금 보낼 수 있다', resendLeft(0, NOW), 0);
check('방금 보냈으면 꽉 기다린다', resendLeft(NOW, NOW), SYNC.verifyWaitMs / 1000);
check('10초 지났으면 나머지', resendLeft(NOW - 10_000, NOW), 50);
check('다 기다렸으면 0', resendLeft(NOW - SYNC.verifyWaitMs, NOW), 0);
check('더 지나도 0 아래로 안 간다', resendLeft(NOW - 999_000, NOW), 0);

console.log('\n── 보내도 되나 ──');
check('처음 한 번은 언제나 보낸다',
  canSend({ first: true, busy: false, mailAt: NOW }, NOW), { ok: true });
check('**연달아 누르면 안 나간다**',
  canSend({ first: false, busy: false, mailAt: NOW }, NOW),
  { ok: false, reason: 'wait', sec: 60 });
check('기다린 뒤에는 나간다',
  canSend({ first: false, busy: false, mailAt: NOW - 60_000 }, NOW), { ok: true });
check('**보내는 중에 또 누르면 한 번만 나간다**',
  canSend({ first: true, busy: true, mailAt: 0 }, NOW), { ok: false, reason: 'busy' });

console.log('\n── 서버가 거절했을 때 ──');
check('인증은 됐는데 거절 → 토큰이 죽은 것', deniedMeans(true), 'logged-out');
check('**아직 인증 전 → 로그아웃이 아니다**', deniedMeans(false), 'unverified');
check('못 물어봤으면 그대로 둔다', deniedMeans(null), 'unknown');
ok('세 갈래가 서로 다르다',
  new Set([deniedMeans(true), deniedMeans(false), deniedMeans(null)]).size === 3);
done('메일 인증');
