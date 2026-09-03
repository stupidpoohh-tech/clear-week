/*
 * 표시 둘 — 스피커와 사람. 웹의 SVG 경로를 그대로 가져왔다.
 * 아이콘 꾸러미를 들이지 않는다: 그림 둘 때문에 의존이 늘 이유가 없다.
 * Skia는 어차피 획을 그리느라 이미 들어와 있다.
 */
import React from 'react';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { COLOR } from '../core/constants.js';

const SPEAKER = 'M3.4 7.7h2.9l4.1-3.2v11l-4.1-3.2H3.4z';
const WAVE = 'M13.2 7.4a3.6 3.6 0 0 1 0 5.2 M15.5 5.4a6.5 6.5 0 0 1 0 9.2';
const MUTE = 'M13.3 7.9l4.3 4.2 M17.6 7.9l-4.3 4.2';
const HEAD = 'M13.1 6.7a3.1 3.1 0 1 1-6.2 0 3.1 3.1 0 0 1 6.2 0z';
const BODY = 'M4.1 16.6a5.9 5.9 0 0 1 11.8 0';

const make = d => Skia.Path.MakeFromSVGString(d);

export function SoundIcon({ on, size = 20 }) {
  const s = size / 20;
  return (
    <Canvas style={{ width: size, height: size }}>
      <Path path={make(SPEAKER)} color={on ? COLOR.ink : COLOR.inkFaint}
        style="stroke" strokeWidth={1.4 / s} transform={[{ scale: s }]} />
      <Path path={make(on ? WAVE : MUTE)} color={on ? COLOR.ink : COLOR.inkFaint}
        style="stroke" strokeWidth={1.4 / s} strokeCap="round" transform={[{ scale: s }]} />
    </Canvas>
  );
}

/* **로그인돼 있으면 진해진다** — 열어 보지 않아도 상태를 안다 */
export function AccountIcon({ linked, size = 20 }) {
  const s = size / 20;
  const color = linked ? COLOR.ink : COLOR.inkFaint;
  return (
    <Canvas style={{ width: size, height: size }}>
      <Path path={make(HEAD)} color={color} style="stroke" strokeWidth={1.4 / s}
        transform={[{ scale: s }]} />
      <Path path={make(BODY)} color={color} style="stroke" strokeWidth={1.4 / s}
        strokeCap="round" transform={[{ scale: s }]} />
    </Canvas>
  );
}
