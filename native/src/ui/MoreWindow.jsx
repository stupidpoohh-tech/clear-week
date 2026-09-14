/*
 * 잘린 것 보기 (P1-2).
 *
 * 한 화면에 안 들어간 항목은 `+3`으로 **잘렸다는 사실만** 알렸다 (spec §3).
 * 사실을 아는 것과 닿는 것은 다르다 — 적어 둔 것을 다시 보지도, 고치지도,
 * 지우지도 못하는 자리가 남아 있었다. 데이터는 있는데 손이 안 닿는 것이다.
 *
 * **새 화면을 만들지 않았다.** 목록 화면도, 프로젝트도, 검색도 아니다.
 * 그 칸에서 넘친 것만 잠깐 펴 보는 창이고, 손짓은 주간 표와 같다 —
 * **누르면 고치고, 꾹 누르면 지운다.** 밖을 누르면 닫힌다.
 *
 * 이 창은 주간 표를 대신하지 않는다. 늘 열려 있으면 그때는 표가 좁은 것이므로,
 * 고칠 자리는 이 창이 아니라 칸 나누기다.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLOR, SIZE, MORE, STROKE } from '../core/constants.js';
import { t } from '../i18n/index.js';

export default function MoreWindow({ cell, items, onEdit, onDelete, onClose }) {
  if (!cell) return null;
  const rows = Math.min(items.length, MORE.maxRows);
  return (
    <Pressable style={styles.back} onPress={onClose}>
      <Pressable style={styles.card} onPress={() => {}}>
        <Text style={styles.title}>{t('overflow.title', { label: cell.label })}</Text>
        <ScrollView style={{ maxHeight: rows * MORE.rowHeight }}>
          {items.map(it => (
            <Pressable
              key={it.id}
              style={styles.row}
              onPress={() => onEdit(it)}
              onLongPress={() => onDelete(it)}
              delayLongPress={STROKE.longPressMs}
            >
              {/* 그어진 것은 그어진 채로 보인다 — 여기서도 지워지지 않는다 */}
              <Text
                style={[styles.text, it.struck && styles.struck]}
                numberOfLines={2}
              >{it.text}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.foot}>
          <Text style={styles.hint}>{t('overflow.hint')}</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.close}>{t('overflow.close')}</Text>
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
    backgroundColor: COLOR.paper, borderRadius: 10, padding: 16,
    width: '82%', maxWidth: 360, gap: 8,
  },
  title: { fontSize: 12, color: COLOR.inkFaint, fontWeight: '600' },
  row: {
    height: MORE.rowHeight, justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLOR.rule,
  },
  text: { fontSize: SIZE.itemFont + 1, color: COLOR.ink },
  /* 창 안에서는 손그림 획을 다시 그리지 않는다 — 여기는 잉크의 자리가 아니다 */
  struck: { textDecorationLine: 'line-through', color: COLOR.inkFaint },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { fontSize: 11, color: COLOR.inkFaint, flex: 1 },
  close: { fontSize: 13, color: COLOR.ink },
});
