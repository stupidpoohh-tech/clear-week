/* 지우개 — **부분적으로 지워진 상태는 저장하지 않는다.** 손을 뗄 때 결판난다 */
import { check, ok, done } from './_harness.mjs';
import { makeBuckets, rub, newPass, coverage, fullyErased, settle } from '../src/core/erase.js';
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
