/*
 * 진동 — **웹에서 못 하던 것이다.** `navigator.vibrate`는 iOS가 통째로 무시했다.
 * 획이 확정될 때와 잉크가 다 벗겨질 때, 종이에서 손이 느끼던 것을 대신한다.
 * 실패는 삼킨다 — 진동이 안 된다고 긋기가 멈추면 안 된다.
 */
import * as Haptics from 'expo-haptics';

export function onCommit() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function onErase() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
}

export function onDelete() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
