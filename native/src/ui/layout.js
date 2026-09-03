/*
 * 한 주의 자리를 통째로 계산한다.
 *
 * 웹은 브라우저가 자리를 잡아 주고 `getClientRects()`로 되물었다. 네이티브에는
 * 그 되물음이 없다 — 그래서 **자리를 우리가 정한다.** 재는 것은 글자뿐이고
 * (줄이 몇 개이고 얼마나 넓은지), 나머지는 전부 여기서 나온다.
 *
 * 이렇게 두면 얻는 것이 크다:
 *   - 획을 그릴 좌표와 손짓을 받을 좌표가 **같은 계산에서 나온다.** 어긋날 수 없다.
 *   - 줄 하나하나의 사각형이 숫자 배열로 남아 worklet에서 그대로 읽힌다.
 *   - 이 파일은 화면 없이 검사할 수 있다 (`tests/layout.mjs`).
 *
 * 좌표계는 **주간 표 상자**를 원점으로 한다. 잉크 판(Skia)도 손짓 판도 그 상자에
 * 딱 맞게 얹히므로, 여기서 나온 숫자를 아무도 옮기지 않는다.
 */
import { SIZE, SPLIT, PAD } from '../core/constants.js';
import { WEEK_DAYS, cellLabel } from '../core/week.js';
import { planColumns } from '../core/columns.js';

const metricOf = (metrics, key) => (metrics && metrics[key]) || null;

/* 글자를 아직 못 쟀으면 한 줄로 보고, 폭은 칸을 꽉 채운 것으로 친다.
   처음 한 번 지나가면 실제 값으로 다시 계산된다. */
function linesOf(metrics, key, fallbackWidth) {
  const m = metricOf(metrics, key);
  if (m && m.lines && m.lines.length) return m.lines;
  return [fallbackWidth];
}

export function computeLayout({ width, height, week, monday, metrics }) {
  const freeW = Math.round(width * SIZE.freeWidth);
  const leftW = width - freeW - SPLIT.gap;
  const rowH = height / 7;

  const cells = [];
  const items = [];
  const notes = [];
  const lines = [];
  const strokes = [];

  WEEK_DAYS.forEach((key, i) => {
    layCell({
      key, left: 0, top: i * rowH, width: leftW, height: rowH,
      label: cellLabel(key, monday), split: true,
      week, metrics, cells, items, notes, lines, strokes,
    });
  });

  layCell({
    key: 'free', left: leftW + SPLIT.gap, top: 0, width: freeW, height: height,
    label: 'note', split: false,
    week, metrics, cells, items, notes, lines, strokes,
  });

  return { cells, items, notes, lines, strokes, freeW, leftW, rowH };
}

function layCell(ctx) {
  const { key, left, top, width, height, label, split, week, metrics } = ctx;

  /* 왼쪽 여백 — 날짜와 그 아래 메모가 사는 자리. **여기서 시작한 가로 손짓도
     긋기로 친다** (HANDOFF §3). note 칸에는 여백이 없다. */
  const labelW = key === 'free' ? 0 : SIZE.labelW;
  const bodyLeft = left + labelW;
  const bodyW = width - labelW;
  const headH = key === 'free' ? SIZE.itemHeight : 0;   /* note는 라벨이 위에 눕는다 */
  const bodyTop = top + headH;
  const bodyH = height - headH;

  const list = week.days[key] || [];
  const keyOf = it => key + ':' + it.id;

  /* 배율 1일 때의 높이를 먼저 잡는다 — 몇 단으로 나눌지는 이걸로 정해진다 */
  const heights = list.map(it =>
    linesOf(metrics, keyOf(it), bodyW).length * SIZE.itemHeight);
  const plan = split
    ? planColumns(heights, bodyH, {})
    : { columns: 1, scale: 1, chunks: [chunkAll(list.length)], hidden: overflowOf(heights, bodyH) };

  const scale = plan.scale;
  const lineH = SIZE.itemHeight * scale;
  const colW = (bodyW - SPLIT.gap * (plan.columns - 1)) / plan.columns;

  let lowest = bodyTop;   /* 적힌 것들 중 가장 아래 — 펜 판이 여기서부터 시작한다 */

  plan.chunks.forEach((chunk, ci) => {
    const colX = bodyLeft + ci * (colW + SPLIT.gap);
    let y = bodyTop;
    chunk.forEach(idx => {
      const it = list[idx];
      const widths = linesOf(metrics, keyOf(it), colW);
      const h = widths.length * lineH;
      const rec = {
        key, id: it.id, kind: 'item', text: it.text, struck: it.struck,
        x: colX, y, w: colW, h, scale,
        fontSize: SIZE.itemFont * scale,
        lineHeight: lineH,
      };
      ctx.items.push(rec);
      widths.forEach((w, li) => {
        const lineTop = y + li * lineH;
        const line = {
          key, id: it.id, kind: 'item', line: li,
          left: colX, right: colX + Math.min(w, colW),
          top: lineTop, bottom: lineTop + lineH,
        };
        ctx.lines.push(line);
        addStrokes(ctx.strokes, it.strikes, line, li);
      });
      y += h;
      if (y > lowest) lowest = y;
    });
  });

  /* 요일 아래 메모 — 항목과 **똑같이** 긋고 지우고 삭제된다 (spec §4-6).
     다만 `.item`이 아니다: 훑어 지우기와 넘침 세기에 끼어들면 안 된다. */
  const noteText = (week.notes && week.notes[key]) || '';
  const noteRect = key === 'free' ? null : {
    key, kind: 'note', x: left + 2, y: top + SIZE.itemHeight * 0.72,
    w: labelW - 2, h: SIZE.sublabelFont * 1.6, text: noteText,
  };
  if (noteRect && noteText) {
    const widths = linesOf(metrics, key + ':note', noteRect.w);
    widths.forEach((w, li) => {
      const lineTop = noteRect.y + li * noteRect.h;
      const line = {
        key, id: 'note', kind: 'note', line: li,
        left: noteRect.x, right: noteRect.x + Math.min(w, noteRect.w),
        top: lineTop, bottom: lineTop + noteRect.h,
      };
      ctx.lines.push(line);
      addStrokes(ctx.strokes, (week.noteStrikes && week.noteStrikes[key]) || [], line, li);
    });
  }
  if (noteRect) ctx.notes.push(noteRect);

  /* 펜 판 — **글자가 있는 높이에는 두지 않는다.** 스크리블은 포인터를 따르지
     않아서, 판이 글자 밑에 깔려 있기만 해도 그 위의 펜을 낚아챈다.
     그러면 취소선이 새 글자로 들어간다 (HANDOFF §4-1). */
  const room = top + height - lowest;
  const pad = room >= PAD.minRoom
    ? { key, x: bodyLeft, y: lowest, w: bodyW, h: room }
    : null;

  ctx.cells.push({
    key, label, left, top, right: left + width, bottom: top + height,
    labelRect: { x: left, y: top, w: labelW || width, h: headH || SIZE.itemHeight },
    bodyLeft, bodyTop, bodyW, bodyH,
    columns: plan.columns, scale, hidden: plan.hidden, pad, lowest,
  });
}

/* 획 하나를 그 줄 위에 앉힌다. 저장된 것은 비율이라 줄 폭만 알면 된다 */
function addStrokes(out, strikes, line, li) {
  const width = Math.max(1, line.right - line.left);
  (strikes || []).forEach((rec, index) => {
    if ((rec.line || 0) !== li) return;
    out.push({
      key: line.key, id: line.id, kind: line.kind, index,
      line: li, seed: rec.seed, a: rec.a, b: rec.b,
      lineLeft: line.left, lineWidth: width,
      minX: line.left + Math.min(rec.a, rec.b) * width,
      maxX: line.left + Math.max(rec.a, rec.b) * width,
      y: (line.top + line.bottom) / 2,
      halfH: (line.bottom - line.top) / 2,
    });
  });
}

const chunkAll = n => Array.from({ length: n }, (_, i) => i);

function overflowOf(heights, availH) {
  let used = 0;
  for (let i = 0; i < heights.length; i++) {
    used += heights[i];
    if (used > availH) return heights.length - i;
  }
  return 0;
}
