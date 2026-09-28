/* 지우개 — **부분적으로 지워진 상태는 저장하지 않는다.** 손을 뗄 때 결판난다 */
import { check, ok, done } from './_harness.mjs';
import { makeBuckets, rub, newPass, coverage, fullyErased, settle, sweptBack } from '../src/core/erase.js';
import { ERASE } from '../src/core/constants.js';

console.log('\n── 자국 ──');
const s = makeBuckets(0, 80);
check('bucketPx 폭으로 잘린다', s.buckets.length, Math.ceil(80 / ERASE.bucketPx));
rub(s, 40);
ok('지우개 반경만큼 걸린다', s.buckets.filter(v => v > 0).length >= 2 * ERASE.radius / ERASE.bucketPx);

console.log('\n── 한 번 지나갈 때 같은 칸은 한 번만 ──');
const a = makeBuckets(0, 80);
rub(a, 40); const first = a.buckets[5];
rub(a, 40);
check('같은 자리를 또 문대도 그대로', a.buckets[5], first);
newPass(a);
rub(a, 40);
ok('**손이 방향을 바꾸면 더 지워진다**', a.buckets[5] > first);

/*
 * **되짚으면 한 번에** (spec §20, 2026-09-27).
 * 문지르기는 두 번 이상 오가야 지워진다 — 급한 손에는 안 들었다.
 * 긋는 방향의 반대(오→왼)로 한 번 쓸면 그 획은 통째로 사라진다.
 */
console.log('\n── 되짚기 ──');
{
  const stroke = { minX: 100, maxX: 200 };
  const sweep = (from, to, turns = 0) =>
    ({ from, to, back: to < from - 8, straight: turns === 0 });

  ok('**오른쪽에서 왼쪽으로 쓸면 지워진다**', sweptBack(sweep(205, 95), stroke));
  ok('긋는 방향(왼→오)으로 쓴 것은 지우기가 아니다', !sweptBack(sweep(95, 205), stroke));
  ok('끝만 살짝 되짚은 것은 아니다', !sweptBack(sweep(205, 180), stroke));
  ok('**오갔으면 문지른 것이다** — 그쪽은 쌓인 양으로 결판난다',
    !sweptBack(sweep(205, 95, 2), stroke));
  ok('획 밖에서 시작해도 획을 지나면 된다', sweptBack(sweep(400, -50), stroke));
  ok('획을 안 지나면 아니다', sweptBack(sweep(400, 250), stroke) === false);
  ok('아무것도 없으면 아니다', !sweptBack(null, stroke));

  /* 반쯤 되짚은 것은? 폭의 55%가 경계다 */
  ok('절반 넘게 되짚으면 지워진다', sweptBack(sweep(200, 140), stroke));
  ok('절반도 안 되면 남는다', !sweptBack(sweep(200, 160), stroke));
}

console.log('\n── 결판 ──');
const b = makeBuckets(0, 40);
for (let i = 0; i < 4; i++) { newPass(b); for (let x = 0; x <= 40; x += 4) rub(b, x); }
ok('넓게 여러 번 문대면 다 지워진다', fullyErased(b));
check('손을 떼면 마저 지운다', settle(b), 'remove');

const c = makeBuckets(0, 200);
newPass(c); rub(c, 10);
ok('끝만 살짝 문댄 것은 아직이다', coverage(c) < ERASE.finishRatio);
check('**덜 지웠으면 잉크를 온전히 되돌린다**', settle(c), 'restore');
done('지우개');
