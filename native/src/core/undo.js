/*
 * 되돌리기 — **지운 직후에만, 한 손잡이로** (P1-2).
 *
 * 롱프레스 삭제는 확인도 취소도 없었다. 손이 미끄러지면 그걸로 끝이었다.
 * 그렇다고 "정말 지울까요?"를 띄우면 **지울 때마다 사람을 세운다** — 이 제품은
 * 손이 덜 가는 쪽이 옳다(규칙 6). 그래서 묻지 않고 지우되, 짧은 동안만
 * 되돌릴 손잡이를 머리말 아래에 둔다. 시간이 지나면 그대로 확정된다.
 *
 * **삭제함을 만들지 않는다.** 지운 것을 모아 두는 자리가 생기면 그것을 비우는
 * 일이 또 생긴다. 여기 있는 것은 방금 지운 것 하나(또는 한 손짓에 지운 묶음)뿐이고,
 * 앱을 닫으면 사라진다.
 *
 * 되돌리기는 **지운 표시(graves)를 걷어내고 다시 적는 것**이다. 다시 적는 시각을
 * 지금으로 두어야 다른 기기의 지운 표시를 이긴다 — 안 그러면 되돌린 것이
 * 다음 동기화에서 도로 지워진다 (spec §11의 합치기 규칙).
 */

/* 항목 하나를 지우기 직전의 모습으로 담는다 */
export const captureItem = (key, item) => ({ kind: 'item', key, item: { ...item } });

/* 메모는 글자와 획이 한 몸이다 — 둘 다 담는다 (spec §4-6) */
export const captureNote = (key, text, strikes) =>
  ({ kind: 'note', key, text, strikes: (strikes || []).map(s => ({ ...s })) });

/* 한 손짓에 여러 개를 지웠으면 묶음으로 */
export const captureMany = snaps => ({ kind: 'many', snaps: snaps.filter(Boolean) });

export const countOf = snap => {
  if (!snap) return 0;
  if (snap.kind === 'many') return snap.snaps.length;
  return 1;
};

/*
 * 담아 둔 것을 주에 되돌린다. **새 주를 돌려준다** (원본은 건드리지 않는다).
 * `model.js`를 부르지 않는 이유: 되돌리기는 "다시 적기"가 아니라 **그 자리에
 * 그대로 되돌리기**다. id도 적은 시각도 그대로여야 같은 것으로 취급된다.
 */
export function revert(week, snap, now = Date.now()) {
  if (!snap) return week;
  if (snap.kind === 'many') {
    return snap.snaps.reduce((w, one) => revert(w, one, now), week);
  }

  if (snap.kind === 'note') {
    return {
      ...week,
      notes: { ...week.notes, [snap.key]: snap.text },
      noteStrikes: { ...week.noteStrikes, [snap.key]: snap.strikes.map(s => ({ ...s })) },
      noteAt: { ...week.noteAt, [snap.key]: now },
    };
  }

  const list = week.days[snap.key] || [];
  if (list.some(it => it.id === snap.item.id)) return week;   // 이미 있다
  const graves = { ...week.graves };
  delete graves[snap.item.id];                                 /* 지운 표시를 걷는다 */
  return {
    ...week,
    days: {
      ...week.days,
      /* 순서는 `createdAt`으로 정해지므로 뒤에 붙여도 제자리로 간다 */
      [snap.key]: [...list, { ...snap.item, updatedAt: now }],
    },
    graves,
  };
}
