/* 획 — **같은 시드는 같은 획.** 좌표를 저장하지 않는 근거가 이것이다 */
import { check, ok, done } from './_harness.mjs';
import {
  makeGrain, grainNoise, widthForSpeed, extendPoints, pointsFromRecord,
  strokeOutline, commits, recordFor,
} from '../src/core/grain.js';
import { STROKE } from '../src/core/constants.js';

console.log('\n── 결 ──');
const g1 = makeGrain(1074304443), g2 = makeGrain(1074304443), g3 = makeGrain(7);
check('같은 시드는 같은 결', g1, g2);
ok('다른 시드는 다른 결', JSON.stringify(g1) !== JSON.stringify(g3));
ok('흔들림은 진폭 안에 있다',
  [0, 13, 57, 120].every(x => Math.abs(grainNoise(g1, x)) <= STROKE.noiseAmplitude + 1e-9));

console.log('\n── 굵기는 속도를 따른다 ──');
check('아주 느리면 가장 굵다', widthForSpeed(0), STROKE.widthMax);
check('기준 속도면 가장 얇다', widthForSpeed(STROKE.speedRef), STROKE.widthMin);
ok('빨라도 최소보다 얇아지지 않는다', widthForSpeed(99) === STROKE.widthMin);

console.log('\n── 점과 윤곽 ──');
const pts = [];
extendPoints(pts, g1, 0, 10, 0, 0, 2);
extendPoints(pts, g1, 30, 10, 0, 0, 2);
ok('손가락이 빨라도 점이 촘촘히 채워진다', pts.length >= 30 / STROKE.stepPx);
ok('점은 x가 자란다', pts[pts.length - 1].x === 30);

const flat = strokeOutline(pts, 1);
ok('윤곽은 위로 갔다 아래로 돌아온다 — 채움이라 점 수의 두 배', flat.length === pts.length * 4);
check('절반만 그리면 절반만 나온다',
  strokeOutline(pts, 0.5).length, Math.round(pts.length * 0.5) * 4);
check('점이 모자라면 아무것도 아니다', strokeOutline([pts[0]], 1), []);

console.log('\n── 같은 기록은 어느 폭에서도 같은 자리에 온다 ──');
const rec = { line: 0, a: 0.1, b: 0.9, seed: 42 };
const wide = pointsFromRecord(rec, 100, 200, 30);
check('시작은 비율대로', Math.round(wide[0].x), 120);
check('끝도 비율대로', Math.round(wide[wide.length - 1].x), 280);
const narrow = pointsFromRecord(rec, 0, 100, 30);
check('폭이 바뀌어도 비율은 지켜진다',
  [Math.round(narrow[0].x), Math.round(narrow[narrow.length - 1].x)], [10, 90]);
check('두 번 그려도 같다', pointsFromRecord(rec, 0, 100, 30), narrow);

console.log('\n── 확정 ──');
ok('줄 폭의 60%를 넘으면 확정', commits(0, 65, 0, 100));
ok('모자라면 되감긴다', !commits(0, 55, 0, 100));
ok('줄 밖으로 지나간 것은 세지 않는다', !commits(-100, 55, 0, 100));

const r = recordFor(-50, 150, 0, 100, 0, 9);
ok('**잉크는 글자에서부터 나온다** — 왼쪽은 overshoot까지만',
  Math.abs(r.a * 100 + STROKE.overshoot) < 1e-9);
ok('오른쪽도 overshoot까지만',
  Math.abs(r.b * 100 - (100 + STROKE.overshoot)) < 1e-9);
check('시드가 함께 남는다', r.seed, 9);
done('획');
