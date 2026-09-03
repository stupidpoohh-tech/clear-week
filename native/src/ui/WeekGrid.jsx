/*
 * 주간 표 — 글자만 그린다. 획은 위에 얹힌 잉크 판이 그린다.
 *
 * 자리는 전부 `layout.js`가 정한 것을 그대로 쓴다. 여기서는 아무것도 재지 않는다 —
 * **글자가 몇 줄이고 얼마나 넓은지만** 되돌려 준다(`onTextLayout`). 그 값이
 * 다음 계산에 들어가 칸이 몇 단으로 나뉠지, 획이 어디서 끝날지를 정한다.
 *
 * **세로선은 없다.** 열은 여백으로만 갈린다. 요일 사이의 가로선만 아주 옅게 둔다.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLOR, SIZE } from '../core/constants.js';

const same = (a, b) => a && b && a.length === b.length &&
  a.every((v, i) => Math.abs(v - b[i]) < 0.5);

function Measured({ text, style, mkey, metrics, onMeasure, numberOfLines }) {
  const handle = React.useCallback(e => {
    const widths = e.nativeEvent.lines.map(l => l.width);
    const prev = metrics[mkey] && metrics[mkey].lines;
    if (!same(prev, widths)) onMeasure(mkey, widths);
  }, [mkey, metrics, onMeasure]);
  return (
    <Text style={style} onTextLayout={handle} numberOfLines={numberOfLines}>
      {text}
    </Text>
  );
}

export default function WeekGrid({ layout, week, metrics, onMeasure, editingKey }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {layout.cells.map(c => (
        <View key={c.key} style={{
          position: 'absolute',
          left: c.left, top: c.top,
          width: c.right - c.left, height: c.bottom - c.top,
          borderTopWidth: c.key === 'free' || c.top === 0 ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: COLOR.rule,
        }} />
      ))}

      {/* 날짜 / note 라벨 */}
      {layout.cells.map(c => (
        <Text key={'l' + c.key} style={[styles.label, {
          position: 'absolute',
          left: c.labelRect.x + 2,
          top: c.labelRect.y + 3,
          width: c.labelRect.w,
        }]}>{c.label}</Text>
      ))}

      {/* 요일 아래 메모 — 6.5pt 세미볼드. 항목과 똑같이 그어지고 지워진다 */}
      {layout.notes.filter(n => n.text).map(n => (
        <View key={'n' + n.key} style={{ position: 'absolute', left: n.x, top: n.y, width: n.w }}>
          <Measured
            mkey={n.key + ':note'} text={n.text} metrics={metrics} onMeasure={onMeasure}
            style={[styles.note, { lineHeight: n.h }]}
          />
        </View>
      ))}

      {/* 항목 */}
      {layout.items.map(it => (
        <View key={it.key + it.id} style={{
          position: 'absolute', left: it.x, top: it.y, width: it.w, height: it.h,
          opacity: editingKey === it.key + ':' + it.id ? 0 : 1,
        }}>
          <Measured
            mkey={it.key + ':' + it.id} text={it.text} metrics={metrics} onMeasure={onMeasure}
            style={[styles.item, { fontSize: it.fontSize, lineHeight: it.lineHeight }]}
          />
        </View>
      ))}

      {/* 넘친 것 — 숨기거나 접지 않고 **잘렸다는 사실만** 알린다 */}
      {layout.cells.filter(c => c.hidden > 0).map(c => (
        <Text key={'o' + c.key} style={[styles.over, {
          position: 'absolute', right: 2, top: c.bottom - 12,
        }]}>+{c.hidden}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: SIZE.itemFont, color: COLOR.ink, fontWeight: '600',
  },
  note: {
    fontSize: SIZE.sublabelFont, color: COLOR.inkFaint, fontWeight: '600',
  },
  item: {
    color: COLOR.ink,
  },
  over: {
    fontSize: SIZE.sublabelFont, color: COLOR.inkFaint,
  },
});
