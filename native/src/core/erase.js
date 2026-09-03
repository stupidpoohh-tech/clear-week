/*
 * 지우개 — 문지른 자리만 잉크가 벗겨진다.
 *
 * 두 가지가 따로 돈다.
 *   1. **보이는 것** — 문댄 자국(trail)을 잉크 위에 dstOut으로 덮는다 (그림은 UI 쪽).
 *   2. **판정** — 획을 bucketPx 폭으로 잘라 얼마나 지워졌는지 센다. 여기.
 *
 * **부분적으로 지워진 상태는 저장하지 않는다** (HANDOFF §4-6). 손을 뗄 때
 * 둘 중 하나로 결판난다: finishRatio 이상이면 마저 지우고, 아니면 온전히 되돌린다.
 * 양 끝은 문대는 손이 되돌아가는 자리라 한 번밖에 안 지나가서 늘 잔흔이 남았다 —
 * 그 잔흔이 "여러 번 지워도 흔적이 남는다"의 정체였다.
 */
import { ERASE } from './constants.js';
import { clamp } from './grain.js';

export function makeBuckets(minX, maxX) {
  'worklet';
  const n = Math.max(1, Math.ceil((maxX - minX) / ERASE.bucketPx));
  const buckets = [];
  for (let i = 0; i < n; i++) buckets.push(0);
  return { minX, maxX, buckets, touched: {} };
}

/* 한 번 지나감. **한 번 지나갈 때 같은 칸은 한 번만 센다** — 같은 자리를
   오갈수록(방향이 바뀔 때마다 newPass) 더 지워지게 하려는 것이다. */
export function rub(state, x) {
  'worklet';
  const n = state.buckets.length;
  const i0 = clamp(Math.floor((x - ERASE.radius - state.minX) / ERASE.bucketPx), 0, n - 1);
  const i1 = clamp(Math.floor((x + ERASE.radius - state.minX) / ERASE.bucketPx), 0, n - 1);
  for (let i = i0; i <= i1; i++) {
    if (!state.touched[i]) {
      state.touched[i] = 1;
      state.buckets[i] += ERASE.passStrength;
    }
  }
  return state;
}

/* 손이 방향을 바꿨다 — 새 지나감으로 친다 */
export function newPass(state) {
  'worklet';
  state.touched = {};
  return state;
}

export function coverage(state) {
  'worklet';
  let done = 0;
  for (let i = 0; i < state.buckets.length; i++) {
    if (state.buckets[i] >= ERASE.doneThreshold) done++;
  }
  return done / state.buckets.length;
}

/* 다 지워졌나 — 문대는 도중에도 이게 참이면 그 자리에서 없앤다 */
export function fullyErased(state) {
  'worklet';
  return coverage(state) >= 1;
}

/* 손을 뗄 때의 결판 */
export function settle(state) {
  'worklet';
  return coverage(state) >= ERASE.finishRatio ? 'remove' : 'restore';
}
