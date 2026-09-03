/*
 * 적는 자리 — 탭하면 그 자리에 열린다.
 *
 * **목록에 끼우지 않고 얹는다.** 목록 안에 입력창을 끼우면 자판이 올라올 때
 * 브라우저·OS가 그 상자를 굴려 적힌 것들이 밀려난다 (HANDOFF §4-2).
 * 한 주가 한 화면인 이 제품에서는 밀려나는 순간 끝이다.
 *
 * **적은 것을 지키는 장치는 blur 말고 둘 더 있다** (HANDOFF §4-8):
 * 딴 데를 누르는 순간(뒤판), 앱이 뒤로 넘어가는 순간(AppState).
 * 모바일 자판의 blur는 언제 오는지 믿을 수 없다. 확정은 여러 번 불려도 한 번만 먹는다.
 */
import React from 'react';
import { AppState, Pressable, StyleSheet, TextInput } from 'react-native';
import { COLOR } from '../core/constants.js';
import * as Sound from '../audio/sound.js';

export default function Editor({ rect, value, fontSize, onCommit, onCancel }) {
  const [text, setText] = React.useState(value || '');
  const done = React.useRef(false);
  const latest = React.useRef(text);
  latest.current = text;

  const commit = React.useCallback(() => {
    if (done.current) return;
    done.current = true;
    onCommit(latest.current.trim());
  }, [onCommit]);

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active') commit();
    });
    return () => sub.remove();
  }, [commit]);

  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={commit} />
      <TextInput
        style={{
          position: 'absolute',
          left: rect.x, top: rect.y, width: rect.w,
          height: Math.max(rect.h, fontSize * 1.6),
          fontSize, color: COLOR.ink, padding: 0,
          backgroundColor: COLOR.paper,
        }}
        value={text}
        autoFocus
        selectTextOnFocus={false}
        returnKeyType="done"
        blurOnSubmit
        onChangeText={t => { setText(t); Sound.tap(); }}
        onSubmitEditing={commit}
        onBlur={commit}
      />
    </>
  );
}
