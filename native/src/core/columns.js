/*
 * 칸 나누기 — **제스처가 아니다.** 한 열에 안 들어가면 저절로 나뉜다.
 *
 * 기준을 항목 수로 못 박지 않는 이유: 한 열에 들어가는 줄 수가 화면 높이에
 * 따라 다르다(작은 폰 3줄, 큰 폰 4줄). 숫자를 박으면 어떤 폰에서는 자리가
 * 남는데 나뉘고, 어떤 폰에서는 나뉘어도 잘린다. **실제로 넘치는지 보고 정한다.**
 *
 * 넘치는 것은 숨기지 않는다 — 칸 오른쪽 아래에 `+3`으로 **잘렸다는 사실만** 알린다.
 * 세로선은 그리지 않는다. 열은 여백으로만 갈린다.
 */
import { SPLIT } from './constants.js';

/*
 * heights: 배율 1일 때 항목들이 차지하는 높이(줄바꿈까지 반영된 실측값)
 * availH:  칸 안에서 항목이 쓸 수 있는 높이
 * 돌려주는 것: { columns, scale, chunks: [[항목번호…], …], hidden }
 */
export function planColumns(heights, availH, opts = {}) {
  const max = opts.maxColumns || SPLIT.maxColumns;
  const scales = opts.scales || SPLIT.scales;
  const n = heights.length;
  if (!n) return { columns: 1, scale: 1, chunks: [[]], hidden: 0 };

  let last = null;
  for (let cols = 1; cols <= max; cols++) {
    const scale = scales[Math.min(cols - 1, scales.length - 1)];
    const plan = fill(heights, availH, cols, scale);
    if (!plan.hidden) return plan;
    last = plan;
  }
  return last;      /* 최대까지 나눠도 넘치면 그대로 두고 잘렸다고 알린다 */
}

/* 왼쪽 열부터 채운다. 한 항목이 통째로 다음 열로 넘어간다 — 항목이 열에
   걸쳐 반씩 잘리면 그 위를 긋는 것이 무슨 뜻인지 알 수 없어진다. */
function fill(heights, availH, cols, scale) {
  const chunks = [];
  let col = [], used = 0, hidden = 0;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i] * scale;
    if (used + h > availH && col.length) {
      chunks.push(col); col = []; used = 0;
      if (chunks.length >= cols) { hidden = heights.length - i; break; }
    }
    col.push(i); used += h;
  }
  if (!hidden && col.length) chunks.push(col);
  while (chunks.length < cols) chunks.push([]);
  return { columns: cols, scale, chunks, hidden };
}
