/*
 * 첫 실행 안내 — 카드 한 장, 줄 넷 (spec §4-4).
 *
 * 초안은 온보딩을 금지했다. 그 이유는 옳다 — 설명이 필요한 인터페이스는 대개
 * 잘못 만든 것이다. 그런데 이 앱은 **버튼이 하나도 없다.** 조항이 아니라
 * 상황이 달라졌다.
 *
 * **안내는 앱의 상태를 건드리지 않는다.** 표본 주를 그리고 셀로판지를 덧대던
 * 방식은 물렸다 — 저장·동기화 경로에 "지금은 표본이니 멈춰라" 가드를 심어야 했다.
 * 지금은 그냥 뜬 카드다.
 *
 * **한 번에 한 줄만 진하다.** 아무 데나 누르면 다음 줄로 내려가고, **끝 줄에
 * 닿아야 닫는 손잡이가 살아난다** — 넷을 다 보게 하는 것이 이 안내의 일이다.
 * `다시 보지 않기`는 **체크상자**다. 체크하고 닫아야 영영 안 뜬다.
 * 움직이는 것은 넣지 않았다 (§7). 옅음/진함이 바뀔 뿐이다.
 *
 * **안내에서만 색을 쓴다.** 주간 표는 여전히 단색이다 — 여기서 색은 분류가
 * 아니라 넷을 눈으로 가르는 표시다.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLOR } from '../core/constants.js';

const ROWS = [
  { mark: '＋', text: '빈 곳을 눌러 생성 (요일 아래, 요일 칸, 노트)' },
  { mark: '↔', text: '글자 위를 그어서 완료. 문지르면 지워져요' },
  { mark: '✕', text: '꾹 누르면 삭제' },
  { mark: '사람', text: '로그인하면 기기간 연동할 수 있습니다', needsServer: true },
];

export default function GuideCard({ serverReady, onClose }) {
  const rows = ROWS.filter(r => !r.needsServer || serverReady);
  const [at, setAt] = React.useState(0);
  const [never, setNever] = React.useState(false);
  const last = at >= rows.length - 1;

  const close = () => onClose(never);
  const advance = () => (last ? close() : setAt(at + 1));

  return (
    <Pressable style={styles.back} onPress={advance}>
      <Pressable style={styles.card} onPress={advance}>
        {rows.map((r, i) => (
          <View key={i} style={styles.row}>
            <Text style={[styles.mark, {
              color: COLOR.guide[i], opacity: i === at ? 1 : 0.25,
            }]}>{r.mark}</Text>
            <Text style={[styles.text, { opacity: i === at ? 1 : 0.25 }]}>{r.text}</Text>
          </View>
        ))}

        <View style={styles.foot}>
          <Pressable style={styles.check} onPress={() => setNever(!never)} hitSlop={8}>
            <View style={[styles.box, never && styles.boxOn]}>
              {never ? <Text style={styles.tick}>✓</Text> : null}
            </View>
            <Text style={styles.checkText}>다시 보지 않기</Text>
          </Pressable>
          {/* 닫는 손잡이는 **끝 줄에 닿아야** 살아난다 */}
          <Pressable onPress={close} disabled={!last} hitSlop={8}>
            <Text style={[styles.close, { opacity: last ? 1 : 0.2 }]}>닫기</Text>
          </Pressable>
        </View>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(29,43,80,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  card: {
    backgroundColor: COLOR.paper, borderRadius: 10, padding: 18,
    width: '84%', maxWidth: 380, gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { fontSize: 15, width: 26, textAlign: 'center', fontWeight: '600' },
  text: { fontSize: 13, color: COLOR.ink, flex: 1 },
  foot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 6,
  },
  check: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  box: {
    width: 15, height: 15, borderWidth: 1, borderColor: COLOR.inkFaint, borderRadius: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { borderColor: COLOR.ink },
  tick: { fontSize: 10, color: COLOR.ink, lineHeight: 13 },
  checkText: { fontSize: 12, color: COLOR.inkFaint },
  close: { fontSize: 13, color: COLOR.ink },
});
