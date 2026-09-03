/*
 * 획의 결 — 시드 하나에서 같은 손그림이 나온다.
 *
 * **좌표를 저장하지 않는다** (HANDOFF §4-6). 저장하는 것은
 * `{ line, a, b, seed }` — 줄 번호와 그 줄 안에서의 시작·끝 비율, 그리고 시드다.
 * 화면 폭이 바뀌어도 따라오고, 용량이 작다.
 *
 * 이 파일의 함수는 전부 **worklet 표시가 붙어 있다** — 긋는 동안 JS 스레드를
 * 타면 안 되기 때문이다 (HANDOFF §11). 그래서 닫힘(closure)을 돌려주지 않는다:
 * `makeGrain`은 숫자만 든 평범한 객체를 주고, 그 결을 쓰는 함수는 따로 있다.
 * node 검사에서는 'worklet' 문자열이 그냥 무시된다.
 */
import { STROKE } from './constants.js';

const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

export function mulberry32(seed) {
  'worklet';
  /* 상태를 밖에 두지 않으려고 호출마다 값을 되돌려 준다: [난수, 다음 상태] */
  let a = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/* 시드에서 결을 뽑는다 — 위상 셋과 기울기. 숫자만 든 객체다 */
export function makeGrain(seed) {
  'worklet';
  let s = seed >>> 0;
  const r = [];
  for (let i = 0; i < 4; i++) {
    const [v, next] = mulberry32(s);
    r.push(v); s = next;
  }
  return {
    p1: r[0] * TAU,
    p2: r[1] * TAU,
    p3: r[2] * TAU,
    tilt: (r[3] * 2 - 1) * STROKE.tiltMax,
  };
}

export function grainNoise(g, x) {
  'worklet';
  const f = STROKE.noiseFrequency * TAU;
  return STROKE.noiseAmplitude *
    (0.7 * Math.sin(x * f + g.p1) + 0.3 * Math.sin(x * f * 2.3 + g.p2));
}

export function grainWidth(g, x) {
  'worklet';
  return 1 + STROKE.widthNoise * Math.sin(x * STROKE.widthNoiseFreq * TAU + g.p3);
}

/* 속도(dp/ms) → 굵기. 빠르게 그으면 얇고, 천천히 그으면 굵다 */
export function widthForSpeed(speed) {
  'worklet';
  return STROKE.widthMax -
    (STROKE.widthMax - STROKE.widthMin) * clamp(speed / STROKE.speedRef, 0, 1);
}

/* 점 하나. 손가락의 상하 움직임은 followY만큼만 따라간다 */
export function inkPoint(g, x, baseY, originX, fingerDy, wBase) {
  'worklet';
  return {
    x,
    y: baseY + fingerDy + g.tilt * (x - originX) + grainNoise(g, x),
    w: Math.max(0.5, wBase * grainWidth(g, x)),
  };
}

/* 지난 점에서 x까지 stepPx 간격으로 채운다 (손가락이 빨라도 획이 끊기지 않게) */
export function extendPoints(points, g, x, baseY, originX, fingerDy, wBase) {
  'worklet';
  const last = points.length ? points[points.length - 1] : null;
  if (!last) { points.push(inkPoint(g, x, baseY, originX, fingerDy, wBase)); return points; }
  const gap = x - last.x;
  const steps = Math.max(1, Math.floor(Math.abs(gap) / STROKE.stepPx));
  for (let i = 1; i <= steps; i++) {
    points.push(inkPoint(g, last.x + (gap * i) / steps, baseY, originX, fingerDy, wBase));
  }
  return points;
}

/* 저장된 기록 → 점 배열. 줄의 왼쪽·폭을 알면 어디든 다시 그릴 수 있다 */
export function pointsFromRecord(rec, lineLeft, lineWidth, baseY) {
  'worklet';
  const g = makeGrain(rec.seed);
  const x0 = lineLeft + rec.a * lineWidth;
  const x1 = lineLeft + rec.b * lineWidth;
  const mid = (STROKE.widthMin + STROKE.widthMax) / 2;
  const pts = [];
  const n = Math.max(1, Math.ceil(Math.abs(x1 - x0) / STROKE.stepPx));
  for (let i = 0; i <= n; i++) {
    pts.push(inkPoint(g, x0 + ((x1 - x0) * i) / n, baseY, x0, 0, mid));
  }
  return pts;
}

/*
 * 점 배열 → 채움 윤곽선. 위쪽으로 갔다가 아래쪽으로 돌아온다.
 * 굵기가 점마다 다르므로 선(stroke)이 아니라 **면(fill)**으로 그린다.
 * fraction < 1이면 앞에서부터 그만큼만 — 자라남과 되감김이 이걸로 된다.
 * 돌려주는 것은 [x0,y0,x1,y1,…] 하나짜리 평평한 배열이다 (worklet에서 가볍게).
 */
export function strokeOutline(points, fraction) {
  'worklet';
  const f = fraction === undefined ? 1 : clamp(fraction, 0, 1);
  const n = Math.max(0, Math.round(points.length * f));
  if (n < 2) return [];
  let total = 0;
  const dist = [0];
  for (let i = 1; i < n; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
    dist.push(total);
  }
  if (total < 1) return [];

  const out = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const taper = clamp(Math.min(dist[i], total - dist[i]) / STROKE.taperLen, 0, 1);
    const h = Math.max(0.3, p.w * (0.3 + 0.7 * Math.sqrt(taper))) / 2;
    out.push(p.x, p.y - h);
  }
  for (let i = n - 1; i >= 0; i--) {
    const p = points[i];
    const taper = clamp(Math.min(dist[i], total - dist[i]) / STROKE.taperLen, 0, 1);
    const h = Math.max(0.3, p.w * (0.3 + 0.7 * Math.sqrt(taper))) / 2;
    out.push(p.x, p.y + h);
  }
  return out;
}

/* 손을 뗐을 때 확정할지 — 지나간 폭이 줄 폭의 commitRatio를 넘어야 한다 */
export function commits(minX, maxX, lineLeft, lineRight) {
  'worklet';
  const width = Math.max(1, lineRight - lineLeft);
  const covered = Math.max(0, Math.min(maxX, lineRight) - Math.max(minX, lineLeft));
  return covered / width >= STROKE.commitRatio;
}

/* 확정된 획을 기록으로. **잉크는 글자에서부터 나온다** — 줄 밖으로는
   overshoot까지만 자른다. 안 자르면 날짜 위로 줄이 지나간다 (HANDOFF §3) */
export function recordFor(minX, maxX, lineLeft, lineRight, line, seed) {
  'worklet';
  const width = Math.max(1, lineRight - lineLeft);
  const lo = clamp(minX, lineLeft - STROKE.overshoot, lineRight + STROKE.overshoot);
  const hi = clamp(maxX, lineLeft - STROKE.overshoot, lineRight + STROKE.overshoot);
  return { line, a: (lo - lineLeft) / width, b: (hi - lineLeft) / width, seed };
}
