/*
 * 내 계정 — 주간 화면에 없는 것들이 전부 여기 있다 (spec §12).
 * 동기화·로그인·백업·쓰는 법·만든사람. 화면 아래 푸터를 두려던 시도는 물렸다.
 *
 * **로그인 줄은 서버가 있을 때만 나온다** (spec §13). 설정이 비어 있거나
 * `/api/me`가 아니라고 하면 로그인 자체가 나타나지 않는다 —
 * **로그아웃 상태의 앱은 예전과 완전히 같다.**
 *
 * **가져오기는 덮어쓰지 않는다** — 지금 없는 주만 채운다 (spec §5-1).
 * 있는 주를 덮으면 다른 기기에서 적은 것이 소리 없이 사라진다.
 */
import React from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { COLOR } from '../core/constants.js';

export default function AccountSheet({
  visible, onClose, email, serverReady, status,
  onSignIn, onLogout, onWipe, onGuide, allWeeks, onImport,
}) {
  const [id, setId] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [wipeArmed, setWipeArmed] = React.useState(false);

  const login = async () => {
    setBusy(true); setMsg('');
    try { await onSignIn(id.trim(), pw); setPw(''); }
    catch (e) { setMsg(reason(e)); }
    finally { setBusy(false); }
  };

  /* 백업은 모든 주를 파일 하나로 묶는다 */
  const exportAll = async () => {
    try {
      const name = 'clear-week-' + new Date().toISOString().slice(0, 10) + '.json';
      const f = new File(Paths.cache, name);
      if (f.exists) f.delete();
      f.create();
      f.write(JSON.stringify({ app: 'clear-week', at: Date.now(), weeks: allWeeks() }));
      await Sharing.shareAsync(f.uri, { mimeType: 'application/json', UTI: 'public.json' });
    } catch (e) { setMsg('내보내기 실패: ' + String(e.message || e)); }
  };

  const importAll = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const text = new File(res.assets[0].uri).text();
      const added = onImport(JSON.parse(text));
      setMsg(added ? `${added}주를 가져왔습니다 (있는 주는 그대로)` : '새로 가져올 주가 없습니다');
    } catch (e) { setMsg('가져오기 실패: ' + String(e.message || e)); }
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={onClose}>
      <Pressable style={styles.back} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <ScrollView contentContainerStyle={{ gap: 14 }}>
            <Text style={styles.h}>내 계정</Text>

            {serverReady ? (
              email ? (
                <View style={styles.block}>
                  <Text style={styles.line}>{email}</Text>
                  <Text style={styles.dim}>{status || '이어져 있습니다'}</Text>
                  <Pressable onPress={onLogout}><Text style={styles.act}>로그아웃</Text></Pressable>
                </View>
              ) : (
                <View style={styles.block}>
                  <Text style={styles.dim}>
                    로그인하면 폰·PC·캘린더가 함께 맞춰집니다. 없는 계정이면 만들어 둡니다.
                  </Text>
                  <TextInput style={styles.input} placeholder="이메일" value={id}
                    autoCapitalize="none" keyboardType="email-address"
                    inputMode="email" onChangeText={setId} />
                  <TextInput style={styles.input} placeholder="비밀번호" value={pw}
                    secureTextEntry onChangeText={setPw} />
                  <Pressable onPress={login} disabled={busy}>
                    {busy ? <ActivityIndicator /> : <Text style={styles.act}>로그인 / 가입</Text>}
                  </Pressable>
                </View>
              )
            ) : null}

            <View style={styles.block}>
              <Text style={styles.h2}>백업</Text>
              <Pressable onPress={exportAll}><Text style={styles.act}>내보내기</Text></Pressable>
              <Pressable onPress={importAll}><Text style={styles.act}>가져오기</Text></Pressable>
              <Text style={styles.dim}>가져오기는 덮어쓰지 않습니다 — 지금 없는 주만 채웁니다.</Text>
            </View>

            <View style={styles.block}>
              <Pressable onPress={onGuide}><Text style={styles.act}>쓰는 법</Text></Pressable>
            </View>

            {email ? (
              <View style={styles.block}>
                <Text style={styles.h2}>전부 비우기</Text>
                {/* **되돌릴 수 없으므로 두 번 누른다** */}
                <Pressable onPress={() => {
                  if (!wipeArmed) { setWipeArmed(true); return; }
                  setWipeArmed(false); onWipe();
                }}>
                  <Text style={[styles.act, { color: '#e0453a' }]}>
                    {wipeArmed ? '정말 비웁니다 — 한 번 더' : '전부 비우기'}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {msg ? <Text style={styles.dim}>{msg}</Text> : null}

            <Text style={styles.credit}>Clear Week — 종이 주간 플래너를 그대로</Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function reason(e) {
  const c = String((e && e.code) || (e && e.message) || '');
  if (c === 'network') return '연결되지 않습니다';
  if (c.includes('EMAIL_EXISTS')) return '이미 있는 계정입니다 — 비밀번호를 확인해 주세요';
  if (c.includes('INVALID_LOGIN') || c.includes('INVALID_PASSWORD')) return '비밀번호가 맞지 않습니다';
  if (c.includes('WEAK_PASSWORD')) return '비밀번호는 여섯 자 이상이어야 합니다';
  if (c.includes('INVALID_EMAIL')) return '이메일 모양이 아닙니다';
  return '되지 않았습니다';
}

const styles = StyleSheet.create({
  back: {
    flex: 1, backgroundColor: 'rgba(29,43,80,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  card: {
    backgroundColor: COLOR.paper, borderRadius: 10, padding: 20,
    width: '86%', maxWidth: 400, maxHeight: '80%',
  },
  h: { fontSize: 16, fontWeight: '600', color: COLOR.ink },
  h2: { fontSize: 13, fontWeight: '600', color: COLOR.ink },
  block: { gap: 8 },
  line: { fontSize: 13, color: COLOR.ink },
  dim: { fontSize: 12, color: COLOR.inkFaint, lineHeight: 17 },
  act: { fontSize: 13, color: '#2870ff' },
  input: {
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLOR.rule,
    fontSize: 13, color: COLOR.ink, paddingVertical: 6,
  },
  credit: { fontSize: 11, color: COLOR.inkFaint, marginTop: 4 },
});
