/*
 * 손짓 — 이 제품의 전부.
 *
 * 판 하나가 주간 표 전체를 덮고, 어디를 짚었는지는 **미리 계산해 둔 줄의 자리**로
 * 찾는다 (`layout.js` → `hit.js`). 웹의 `elementFromPoint` 자리다.
 *
 * **긋는 동안 JS 스레드를 타지 않는다** (HANDOFF §11). 획이 자라나는 것은 전부
 * worklet 안에서 끝나고, JS로 넘어가는 것은 확정·삭제 같은 **한 번뿐인 일**이다.
 * 소리만은 예외로 몇 프레임에 한 번 넘긴다 — 오디오는 JS 쪽에 있다.
 *
 * 제스처 공간이 겹치지 않게 짜여 있다 (HANDOFF §3):
 *
 *          | 그어짐            | 안 그어짐
 *   ───────┼──────────────────┼──────────────────
 *   가로   | 지우개            | 긋기
 *   세로   | 당겨서 새로고침 (항목 위에서 시작한 세로는 아무것도 아니다)
 *   탭     | (편집 불가)       | 편집 / 빈 곳이면 새로 적기
 *   더블탭 | —                 | 남은 줄까지 자동으로 긋기
 *   롱프레스| 삭제 — 그대로 끌면 지나간 것 전부
 */
import React from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, runOnJS } from 'react-native-reanimated';
import { STROKE, PULL } from '../core/constants.js';
import { lineAt, lineAtY, cellAt, strokeAt, axisOf } from '../core/hit.js';
import {
  makeGrain, extendPoints, widthForSpeed, commits, recordFor,
} from '../core/grain.js';
import { makeBuckets, rub, newPass, fullyErased, settle } from '../core/erase.js';

export default function GestureSurface({
  children, reg, live, trail, pull, on,
}) {
  const mode = useSharedValue(null);       /* 'strike' | 'erase' | 'pull' | 'delete' */
  const start = useSharedValue({ x: 0, y: 0 });
  const ink = useSharedValue(null);
  const rubs = useSharedValue(null);
  const killed = useSharedValue(null);
  const soundAt = useSharedValue(0);

  /* ── 긋기 ──────────────────────────────────────────────────
     **잉크는 글자에서부터 나온다.** 여백에서 시작한 손짓은 손가락이 글자에
     닿기 전까지 아무것도 남기지 않는다 — 안 그으면 날짜 위로 줄이 지나간다. */
  const beginStrike = (x, y, line) => {
    'worklet';
    const seed = Math.floor(Math.random() * 2147483647);
    ink.value = {
      key: line.key, id: line.id, kind: line.kind, line: line.line,
      lineLeft: line.left, lineRight: line.right,
      baseY: (line.top + line.bottom) / 2,
      originX: Math.max(line.left, Math.min(x, line.right)),
      originY: y, seed, grain: makeGrain(seed),
      points: [], minX: Infinity, maxX: -Infinity,
    };
    mode.value = 'strike';
  };

  const growStrike = (x, y, speed) => {
    'worklet';
    const s = ink.value;
    if (!s) return;
    const lo = s.lineLeft - STROKE.overshoot;
    const hi = s.lineRight + STROKE.overshoot;
    const cx = Math.max(lo, Math.min(x, hi));
    extendPoints(s.points, s.grain, cx, s.baseY,
      s.originX, (y - s.originY) * STROKE.followY, widthForSpeed(speed));
    s.minX = Math.min(s.minX, cx);
    s.maxX = Math.max(s.maxX, cx);
    live.value = { points: s.points, fraction: 1, n: s.points.length };
  };

  /* ── 지우개 ────────────────────────────────────────────────
     **손가락 아래에 있는 것을 지운다** — 손짓을 시작한 항목만이 아니라.
     매번 그 자리의 획을 다시 찾으므로 칸도 단도 넘어간다 (HANDOFF §4-7). */
  const rubAt = (x, y) => {
    'worklet';
    const st = rubs.value;
    if (!st) return;
    const s = strokeAt(reg.value.strokes, x, y);

    /* 문댄 자국은 방향이 바뀔 때마다 새로 시작한다 */
    const dir = x > st.lastX ? 1 : (x < st.lastX ? -1 : st.dir);
    if (dir !== st.dir && dir !== 0) {
      st.dir = dir;
      st.passes.push([]);
      for (const k of Object.keys(st.buckets)) newPass(st.buckets[k]);
    }
    st.lastX = x;
    const pass = st.passes[st.passes.length - 1];
    pass.push(x, y);
    trail.value = st.passes.slice(-10);

    if (!s) return;
    const id = s.key + ':' + s.id + ':' + s.index;
    if (!st.buckets[id]) {
      st.buckets[id] = makeBuckets(s.minX, s.maxX);
      st.seen[id] = s;
    }
    rub(st.buckets[id], x);
    if (fullyErased(st.buckets[id])) {
      delete st.buckets[id];
      runOnJS(on.eraseStroke)(s);
    }
  };

  const endErase = () => {
    'worklet';
    const st = rubs.value;
    trail.value = [];
    if (!st) return;
    /* **손을 뗄 때의 정리는 닿았던 획 전부에 걸린다.** 주인만 정리하면 남의
       항목에 벗겨진 잉크가 남는다 (HANDOFF §4-7). */
    const gone = [];
    for (const k of Object.keys(st.buckets)) {
      if (settle(st.buckets[k]) === 'remove') gone.push(st.seen[k]);
    }
    rubs.value = null;
    if (gone.length) runOnJS(on.eraseMany)(gone);
    else runOnJS(on.eraseRestore)();
  };

  /* ── 한 손짓 ───────────────────────────────────────────────── */
  const pan = Gesture.Pan()
    .minDistance(1)
    .onBegin(e => {
      'worklet';
      start.value = { x: e.x, y: e.y };
      killed.value = {};
      /* 손가락이 닿은 시각을 알려 준다 — 펜 판이 손가락과 펜을 이걸로 가른다
         (스크리블은 포인터 없이 포커스만 준다, HANDOFF §4-1) */
      runOnJS(on.touch)();
    })
    .onUpdate(e => {
      'worklet';
      const s = start.value;

      if (mode.value === null) {
        const axis = axisOf(e.x - s.x, e.y - s.y);
        if (!axis) return;

        if (axis === 'y') {
          /* 세로는 당기기 하나뿐이다. 항목 위에서 시작한 세로는 아무것도 아니다 */
          if (e.y > s.y && !lineAt(reg.value.lines, s.x, s.y)) mode.value = 'pull';
          else mode.value = 'none';
          return;
        }

        /* 가로 — 그어져 있으면 지우개, 아니면 긋기 */
        const over = strokeAt(reg.value.strokes, s.x, s.y);
        if (over) {
          rubs.value = { buckets: {}, seen: {}, passes: [[]], dir: 0, lastX: s.x };
          mode.value = 'erase';
          rubAt(s.x, s.y);
          return;
        }
        /* 글자 위에서 시작했으면 그 줄. 여백에서 시작했으면 **그 높이의 줄** —
           사람들은 날짜가 있는 여백에서 손을 긋기 시작한다 (HANDOFF §3) */
        const cell = cellAt(reg.value.cells, s.x, s.y);
        const line = lineAt(reg.value.lines, s.x, s.y) ||
          (cell ? lineAtY(reg.value.lines, s.y, cell.key) : null);
        if (line) beginStrike(s.x, s.y, line);
        else mode.value = 'none';
        return;
      }

      if (mode.value === 'strike') {
        const speed = Math.abs(e.velocityX) / 1000;
        growStrike(e.x, e.y, speed);
        /* 소리는 JS 쪽에 있다 — 네 번에 한 번만 넘긴다. 매 프레임 넘기면
           긋는 동안 JS를 타지 말라는 규칙을 소리가 혼자 깬다 */
        soundAt.value = (soundAt.value + 1) % 4;
        if (soundAt.value === 0) runOnJS(on.scratch)(speed);
        return;
      }
      if (mode.value === 'erase') { rubAt(e.x, e.y); return; }
      if (mode.value === 'pull') { pull.value = Math.max(0, e.y - s.y); return; }
      if (mode.value === 'delete') {
        const line = lineAt(reg.value.lines, e.x, e.y);
        if (line) {
          const id = line.key + ':' + line.id;
          if (!killed.value[id]) {
            killed.value[id] = 1;
            runOnJS(on.remove)(line.key, line.id, line.kind);
          }
        }
      }
    })
    .onEnd(() => {
      'worklet';
      if (mode.value === 'strike') {
        const s = ink.value;
        if (s && s.points.length > 1) {
          if (commits(s.minX, s.maxX, s.lineLeft, s.lineRight)) {
            runOnJS(on.strike)(s.key, s.id, s.kind,
              recordFor(s.minX, s.maxX, s.lineLeft, s.lineRight, s.line, s.seed));
          } else {
            runOnJS(on.rewind)();   /* 미달 — 선이 되감기며 사라진다 */
          }
        }
      } else if (mode.value === 'erase') {
        endErase();
      } else if (mode.value === 'pull') {
        if (pull.value >= PULL.distance) runOnJS(on.pull)();
        pull.value = 0;
      }
    })
    .onFinalize(() => {
      'worklet';
      if (mode.value === 'strike') { ink.value = null; runOnJS(on.scratchStop)(); }
      if (mode.value === 'erase') { trail.value = []; rubs.value = null; }
      if (mode.value === 'pull') pull.value = 0;
      mode.value = null;
    });

  /* 롱프레스 — **이미 긋고 있으면 오지 않는다.** 손이 멎어 있을 때만 삭제다.
     여백에서 넘겨받은 손짓에도 롱프레스를 걸지 않는다 (HANDOFF §3). */
  const hold = Gesture.LongPress()
    .minDuration(STROKE.longPressMs)
    .maxDistance(10000)
    .onStart(e => {
      'worklet';
      if (mode.value !== null) return;
      const line = lineAt(reg.value.lines, e.x, e.y);
      if (!line) return;
      mode.value = 'delete';
      killed.value = {};
      killed.value[line.key + ':' + line.id] = 1;
      runOnJS(on.remove)(line.key, line.id, line.kind);
    });

  /* 더블탭 — 남은 줄까지 자동으로 긋는다. 드래그가 번거로운 자리를 위한 보조 */
  const double = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(STROKE.doubleTapMs)
    .onEnd((e, ok) => {
      'worklet';
      if (!ok) return;
      const line = lineAt(reg.value.lines, e.x, e.y);
      if (line) runOnJS(on.autoStrike)(line.key, line.id, line.kind);
    });

  /* 탭 — 그어진 항목은 열리지 않는다. 빈 곳이면 그 자리에 적는다 */
  const tap = Gesture.Tap()
    .maxDuration(STROKE.doubleTapMs * 2)
    .onEnd((e, ok) => {
      'worklet';
      if (!ok) return;
      const line = lineAt(reg.value.lines, e.x, e.y);
      if (line) { runOnJS(on.edit)(line.key, line.id, line.kind); return; }
      const cell = cellAt(reg.value.cells, e.x, e.y);
      if (!cell) return;
      /* **누른 자리에 적힌다** — 왼쪽 여백이면 요일 아래 메모, 아니면 항목 */
      const inMargin = cell.key !== 'free' && e.x < cell.bodyLeft;
      runOnJS(on.add)(cell.key, inMargin ? 'note' : 'item');
    });

  const composed = Gesture.Simultaneous(pan, hold, Gesture.Exclusive(double, tap));

  return <GestureDetector gesture={composed}>{children}</GestureDetector>;
}
