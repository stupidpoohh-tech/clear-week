/*
 * 잉크 판 — 취소선은 여기서만 그려진다.
 *
 * **칸마다 판을 두지 않고 주간 표 전체에 하나만 둔다.** 이유가 셋이다:
 *   1. 지우개가 칸도 단도 넘어가야 한다 (HANDOFF §4-7). 판이 하나면 저절로 된다.
 *   2. 60fps로 자라나는 획이 여덟 군데에서 각각 돌면 안 된다.
 *   3. 획은 글자 위에 얹히지만 손짓을 가로채면 안 된다 — 판은 `pointerEvents: none`.
 *
 * **획은 선이 아니라 면이다.** 점마다 굵기가 달라서(속도에 따라 1.6~3.2)
 * 선으로는 그릴 수 없다. `strokeOutline`이 위아래 윤곽을 만들고 그것을 채운다.
 *
 * **지우개는 dstOut으로 덮는다.** 칠한 자리만 잉크가 벗겨진다 — 웹의 SVG mask와
 * 같은 그림이다. 한 번 지나갈 때마다 자국이 하나씩 쌓이므로, 같은 자리를
 * 오갈수록 옅어진다. 층(layer) 안에서 해야 종이까지 뚫리지 않는다.
 */
import React from 'react';
import { Canvas, Group, Path, Skia } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { COLOR, ERASE } from '../core/constants.js';
import { strokeOutline, pointsFromRecord } from '../core/grain.js';

const MAX_PASSES = 10;   /* 문댄 자국은 이만큼까지만 쌓는다. 그 전에 결판이 난다 */

/* 평평한 좌표 배열 → Skia 패스 */
function fillPath(flat) {
  'worklet';
  const p = Skia.Path.Make();
  if (!flat || flat.length < 6) return p;
  p.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) p.lineTo(flat[i], flat[i + 1]);
  p.close();
  return p;
}

function linePath(flat) {
  'worklet';
  const p = Skia.Path.Make();
  if (!flat || flat.length < 4) return p;
  p.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) p.lineTo(flat[i], flat[i + 1]);
  return p;
}

/* 문댄 자국 하나. **한 번 지나감 = 자국 하나**이고, 손이 방향을 바꿀 때마다
   새 자국이 시작된다 — 그래야 같은 자리를 오갈수록 더 지워진다. */
function ErasePass({ index, trail }) {
  const path = useDerivedValue(() => {
    const t = trail.value;
    return linePath(t && t[index] ? t[index] : null);
  });
  return (
    <Path
      path={path}
      style="stroke"
      strokeWidth={ERASE.radius * 2}
      strokeCap="round"
      strokeJoin="round"
      color={COLOR.paper}
      opacity={ERASE.passStrength}
      blendMode="dstOut"
    />
  );
}

export default function InkLayer({ width, height, strokes, hidden, live, trail }) {
  /* 확정된 획 — 손짓이 아니라 데이터가 바뀔 때만 다시 만든다 */
  const committed = React.useMemo(() => {
    const path = Skia.Path.Make();
    for (const s of strokes) {
      if (hidden[s.key + ':' + s.id + ':' + s.index]) continue;
      const pts = pointsFromRecord(s, s.lineLeft, s.lineWidth, s.y);
      const flat = strokeOutline(pts, 1);
      if (flat.length < 6) continue;
      path.moveTo(flat[0], flat[1]);
      for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]);
      path.close();
    }
    return path;
  }, [strokes, hidden]);

  /* 자라나는 획 — UI 스레드에서만 돈다. JS를 타지 않는다 */
  const livePath = useDerivedValue(() => {
    const v = live.value;
    if (!v || !v.points || v.points.length < 2) return Skia.Path.Make();
    return fillPath(strokeOutline(v.points, v.fraction === undefined ? 1 : v.fraction));
  });

  return (
    <Canvas style={{ position: 'absolute', left: 0, top: 0, width, height }} pointerEvents="none">
      <Group layer>
        <Path path={committed} color={COLOR.stroke} />
        <Path path={livePath} color={COLOR.stroke} opacity={0.88} />
        {Array.from({ length: MAX_PASSES }, (_, i) => (
          <ErasePass key={i} index={i} trail={trail} />
        ))}
      </Group>
    </Canvas>
  );
}
