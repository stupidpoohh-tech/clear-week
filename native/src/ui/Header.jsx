/*
 * 머리말 — 주간 화면에는 **머리말과 표뿐이다** (spec §12).
 * 만든 사람도 백업도 로그인도 전부 `내 계정` 안에 있다. 푸터를 화면 아래에
 * 두려던 시도는 물렸다 — 한 주가 한 화면인 제품에서 아래 한 줄은 작지 않았다.
 *
 * `today`는 **이번 주를 벗어났을 때만** 나타난다.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLOR, SIZE, STROKE } from '../core/constants.js';
import { SoundIcon, AccountIcon } from './Icon.jsx';

export default function Header({
  title, away, sound, linked, onPrev, onNext, onToday, onSound, onAccount,
}) {
  return (
    <View style={styles.bar}>
      <Pressable onLongPress={onAccount} delayLongPress={STROKE.longPressMs}
        style={styles.lead} hitSlop={4}>
        <Text style={styles.title}>{title}</Text>
      </Pressable>
      <Pressable onPress={onPrev} hitSlop={10}><Text style={styles.arrow}>‹</Text></Pressable>
      <Pressable onPress={onNext} hitSlop={10}><Text style={styles.arrow}>›</Text></Pressable>
      {away ? (
        <Pressable onPress={onToday} hitSlop={8}>
          <Text style={styles.today}>today</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }} />
      <Pressable onPress={onSound} hitSlop={10} style={styles.icon}>
        <SoundIcon on={sound} />
      </Pressable>
      <Pressable onPress={onAccount} hitSlop={10} style={styles.icon}>
        <AccountIcon linked={linked} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: SIZE.headerH, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, gap: 6,
  },
  lead: { marginRight: 2 },
  title: { fontSize: 15, color: COLOR.ink, fontWeight: '600' },
  arrow: { fontSize: 19, color: COLOR.ink, paddingHorizontal: 3 },
  today: { fontSize: 11, color: COLOR.inkFaint, marginLeft: 2 },
  icon: { marginLeft: 8 },
});
