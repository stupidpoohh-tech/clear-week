/*
 * 어디를 짚었나 — 손짓 판정.
 *
 * 웹은 `elementFromPoint`가 대신 해 줬다. 네이티브에는 그것이 없으므로,
 * 화면이 그려질 때마다 **줄 하나하나의 자리를 등록해 두고** 여기서 찾는다.
 * 등록되는 것은 숫자뿐이라 worklet에서 그대로 읽을 수 있다 —
 * 긋는 동안 JS 스레드를 타지 않기 위해서다 (HANDOFF §11).
 *
 * 줄 하나:
 *   { key, id, kind: 'item'|'note', index, line, left, right, top, bottom }
 *   left/right는 **글자의 폭**이다. 획은 이 안에서 시작하고 끝난다.
 *
 * 제스처 공간이 겹치지 않게 설계돼 있다 (HANDOFF §3):
 *   가로 = 긋기·지우기 / 세로 = 당겨서 새로고침 / 탭 = 적기·편집
 */
import { STROKE, ERASE } from './constants.js';

/* 정확히 그 줄 위인가 — 글자 오른쪽 tapPadPx까지는 아직 '항목 위'로 친다 */
export function lineAt(lines, x, y) {
  'worklet';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (y >= l.top && y <= l.bottom &&
        x >= l.left && x <= l.right + STROKE.tapPadPx) return l;
  }
  return null;
}

/*
 * **여백에서 그어도 인식한다** (HANDOFF §3). 사람들은 글자 왼쪽, 날짜가 있는
 * 여백에서 손을 긋기 시작한다 — 실제 사용에서 그랬다. 가로로 움직인 것이
 * 분명해지는 순간 그 높이의 줄에게 손짓을 넘긴다.
 * 나뉜 칸에서는 **왼쪽 단부터**. 그전에는 넘기지 않는다 — 여백의 롱프레스는
 * 항목 삭제가 아니다.
 */
export function lineAtY(lines, y, key) {
  'worklet';
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (key && l.key !== key) continue;
    if (y < l.top || y > l.bottom) continue;
    if (!best || l.left < best.left) best = l;
  }
  return best;
}

/* 어느 칸인가 — 빈 곳을 눌렀을 때 어디에 적을지 */
export function cellAt(cells, x, y) {
  'worklet';
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (x >= c.left && x <= c.right && y >= c.top && y <= c.bottom) return c;
  }
  return null;
}

/*
 * 그 자리의 획 — 지우개가 쓴다.
 * **지우개는 손가락 아래에 있는 것을 지운다** — 손짓을 시작한 항목만이 아니라.
 * 예전(웹)에는 포인터 캡처 때문에 시작한 항목에 갇혀서, 넓게 문대도 한 줄씩만
 * 지워졌다 (HANDOFF §4-7). 매번 그 자리를 다시 찾으므로 칸도 단도 넘어간다.
 * 어느 줄인지는 가장 가까운 하나다 — 넓게 지우려면 넓게 문대면 된다.
 */
export function strokeAt(strokes, x, y) {
  'worklet';
  let best = null, bestD = Infinity;
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    if (x < s.minX - ERASE.radius || x > s.maxX + ERASE.radius) continue;
    const d = Math.abs(y - s.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best && bestD <= best.halfH + ERASE.reachPx ? best : null;
}

/* 손짓의 성격 — 가로면 긋기·지우기, 세로면 당기기. 초기 방향으로 가른다 */
export function axisOf(dx, dy) {
  'worklet';
  if (Math.abs(dx) < STROKE.slopPx && Math.abs(dy) < STROKE.slopPx) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}
