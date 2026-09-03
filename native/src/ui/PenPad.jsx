/*
 * 펜 판 — **펜을 빈 곳에 대고 그냥 쓰면 적힌다. 탭이 없다** (spec §4-7).
 *
 * 애플펜슬 손글씨 변환(스크리블)은 **포인터 히트 테스트를 따르지 않는다.**
 * iOS가 그 언저리의 입력창을 찾아 획을 가져간다 — 입력창이 글자 **밑에**
 * 깔려 있기만 해도 그 위의 펜을 낚아채, 취소선이 새 글자로 들어간다.
 * z-index로도, RN의 zIndex로도 못 막는다 (HANDOFF §4-1).
 *
 * 그래서 **글자가 있는 높이에는 판을 두지 않는다.** 판은 적힌 것들 아래에서
 * 시작하고, 남은 자리가 `PAD.minRoom`보다 좁으면 아예 없다 (`layout.js`).
 *
 * **손가락과 펜은 포커스가 온 시각으로 가른다.** 스크리블은 포인터 없이
 * 포커스만 주므로 "펜이냐"를 이벤트 종류로 물을 수 없다. 손가락이 누른 직후
 * `PAD.guardMs` 안에 온 포커스는 손가락 것으로 보고 물러난다 — 그 탭은
 * 작은 줄(Editor)이 받아야 한다.
 *
 * 자판은 부르지 않는다(`showSoftInputOnFocus=false`). 판은 글씨를 받는 자리이지
 * 자판을 여는 자리가 아니다.
 */
import React from 'react';
import { TextInput } from 'react-native';
import { PAD, COLOR } from '../core/constants.js';

export default function PenPad({ rect, lastTouch, onWrite }) {
  const ref = React.useRef(null);
  const [awake, setAwake] = React.useState(false);
  const buf = React.useRef('');

  const finish = () => {
    const t = buf.current.trim();
    buf.current = '';
    setAwake(false);
    if (t) onWrite(t);
  };

  return (
    <TextInput
      ref={ref}
      style={{
        position: 'absolute',
        left: rect.x, top: rect.y, width: rect.w, height: rect.h,
        fontSize: PAD.fontPx,
        color: awake ? COLOR.ink : 'transparent',
        padding: 0,
      }}
      value={buf.current}
      multiline
      showSoftInputOnFocus={false}
      onFocus={() => {
        if (Date.now() - lastTouch.current < PAD.guardMs) {
          /* 손가락이다 — 물러난다. 이 탭은 작은 줄이 받는다 */
          ref.current && ref.current.blur();
          return;
        }
        setAwake(true);
      }}
      onChangeText={t => { buf.current = t; }}
      onBlur={finish}
      onEndEditing={finish}
    />
  );
}
