/*
 * 내 계정 — 주간 화면에 없는 것들이 전부 여기 있다 (spec §12).
 * 동기화·로그인·인증·구매·백업·말·쓰는 법·계정 삭제.
 * 화면 아래 푸터를 두려던 시도는 물렸다 — 한 주가 한 화면인 제품에서
 * 아래 한 줄은 작지 않았다.
 *
 * **로그인 줄은 서버가 있을 때만 나온다** (spec §13). 설정이 비어 있거나
 * `/api/me`가 아니라고 하면 로그인 자체가 나타나지 않는다 —
 * **로그아웃 상태의 앱은 예전과 완전히 같다.**
 *
 * **인증 전에는 이어진 척하지 않는다** (P1-1). 그때는 인증 줄만 나오고,
 * 비우기도 계정 삭제도 숨는다 — 아직 서버에 아무것도 없기 때문이다.
 *
 * **가져오기는 덮어쓰지 않는다** — 지금 없는 주만 채운다 (spec §5-1).
 */
import React from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { COLOR } from '../core/constants.js';
import { t, PACKS, getLang } from '../i18n/index.js';
import { isLocked, MESSAGE } from '../core/entitlement.js';

export default function AccountSheet({
  visible, onClose, email, verified, serverReady, status,
  onSignIn, onLogout, onWipe, onGuide, allWeeks, onImport,
  onVerifyCheck, onVerifyResend,
  owned, price, onBuy, onRestore,
  lang, onLang, onDeleteAccount,
}) {
  const [id, setId] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [wipeArmed, setWipeArmed] = React.useState(false);
  const [goneArmed, setGoneArmed] = React.useState(false);
  const [alsoLocal, setAlsoLocal] = React.useState(false);

  const waiting = !!email && !verified;

  const run = async (fn) => {
    setBusy(true); setMsg('');
    try { return await fn(); }
    catch (e) { setMsg(reason(e)); return null; }
    finally { setBusy(false); }
  };

  const login = () => run(async () => { await onSignIn(id.trim(), pw); setPw(''); });

  /* 백업은 모든 주를 파일 하나로 묶는다 */
  const exportAll = async () => {
    try {
      const name = 'clear-week-' + new Date().toISOString().slice(0, 10) + '.json';
      const f = new File(Paths.cache, name);
      if (f.exists) f.delete();
      f.create();
      f.write(JSON.stringify({ app: 'clear-week', at: Date.now(), weeks: allWeeks() }));
      await Sharing.shareAsync(f.uri, { mimeType: 'application/json', UTI: 'public.json' });
    } catch (e) { setMsg(t('err.unknown')); }
  };

  const importAll = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const text = new File(res.assets[0].uri).text();
      const added = onImport(JSON.parse(text));
      setMsg(added ? t('backup.added', { n: added }) : t('backup.none'));
    } catch (e) { setMsg(t('err.unknown')); }
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={onClose}>
      <Pressable style={styles.back} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <ScrollView contentContainerStyle={{ gap: 14 }}>
            <Text style={styles.h}>{t('account.title')}</Text>

            {/*
              * **구매 전에는 로그인 자리가 아예 없다** (P1-4). 이어짐이 구매
              * 뒤에 열리는데 로그인만 먼저 되면, 로그인해 놓고 안 맞춰지는
              * 자리가 생긴다 — 그것이 P0-1에서 고친 바로 그 모양이다.
              */}
            {serverReady && !isLocked('sync', owned) ? (
              email ? (
                <View style={styles.block}>
                  <Text style={styles.line}>{email}</Text>
                  {/* **인증을 기다리는 중은 로그인과도 로그아웃과도 다른 자리다** */}
                  {waiting ? (
                    <>
                      <Text style={styles.dim}>{t('verify.waiting')}</Text>
                      <Row>
                        <Act onPress={() => run(async () =>
                          setMsg(t(await onVerifyCheck() ? 'account.sync' : 'verify.notYet')))}>
                          {t('verify.check')}
                        </Act>
                        <Act onPress={() => run(async () => setMsg(await onVerifyResend()))}>
                          {t('verify.resend')}
                        </Act>
                      </Row>
                    </>
                  ) : (
                    <Text style={styles.dim}>{status || t('account.sync')}</Text>
                  )}
                  <Act onPress={onLogout}>{t('account.logout')}</Act>
                </View>
              ) : (
                <View style={styles.block}>
                  <Text style={styles.dim}>{t('account.loginHint')}</Text>
                  <TextInput style={styles.input} placeholder={t('account.email')} value={id}
                    autoCapitalize="none" keyboardType="email-address"
                    inputMode="email" onChangeText={setId} />
                  <TextInput style={styles.input} placeholder={t('account.password')} value={pw}
                    secureTextEntry onChangeText={setPw} />
                  {busy ? <ActivityIndicator /> : <Act onPress={login}>{t('account.login')}</Act>}
                </View>
              )
            ) : null}

            {/* ── 평생 소장 (P1-4) ───────────────────────────── */}
            <View style={styles.block}>
              <Text style={styles.h2}>{t('buy.title')}</Text>
              {owned ? (
                <Text style={styles.dim}>{t('buy.owned')}</Text>
              ) : (
                <>
                  <Text style={styles.dim}>{t('buy.once')}</Text>
                  {/* 무엇이 열리는지 **누르기 전에** 말한다 */}
                  {serverReady ? <Text style={styles.dim}>{t('buy.locked')}</Text> : null}
                  <Row>
                    <Act onPress={() => run(async () => {
                      const out = await onBuy();
                      setMsg(out.ok ? '' : t(MESSAGE[out.outcome] || 'buy.failed'));
                    })}>{price ? t('buy.action', { price }) : t('buy.actionPlain')}</Act>
                    <Act onPress={() => run(async () => {
                      const out = await onRestore();
                      setMsg(t(out.ok ? 'buy.restored'
                        : (out.outcome === 'nothing' ? 'buy.nothing'
                          : MESSAGE[out.outcome] || 'buy.failed')));
                    })}>{t('buy.restore')}</Act>
                  </Row>
                </>
              )}
            </View>

            <View style={styles.block}>
              <Text style={styles.h2}>{t('account.backup')}</Text>
              <Row>
                <Act onPress={exportAll}>{t('account.export')}</Act>
                <Act onPress={importAll}>{t('account.import')}</Act>
              </Row>
              <Text style={styles.dim}>{t('account.importNote')}</Text>
            </View>

            {/* ── 말 (P1-3) ─────────────────────────────────── */}
            <View style={styles.block}>
              <Text style={styles.h2}>{t('account.language')}</Text>
              <Row>
                {Object.keys(PACKS).map(code => (
                  <Pressable key={code} onPress={() => onLang(code)} hitSlop={6}>
                    <Text style={[styles.act, (lang || getLang()) === code && styles.actOn]}>
                      {code === 'ko' ? '한국어' : 'English'}
                    </Text>
                  </Pressable>
                ))}
              </Row>
            </View>

            <View style={styles.block}>
              <Act onPress={onGuide}>{t('account.guide')}</Act>
            </View>

            {email && verified ? (
              <View style={styles.block}>
                <Text style={styles.h2}>{t('account.wipe')}</Text>
                {/* **되돌릴 수 없으므로 두 번 누른다** */}
                <Pressable onPress={() => {
                  if (!wipeArmed) { setWipeArmed(true); return; }
                  setWipeArmed(false); onWipe();
                }}>
                  <Text style={[styles.act, styles.danger]}>
                    {wipeArmed ? t('account.wipeArmed') : t('account.wipe')}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* ── 계정 삭제 (P1-5) ──────────────────────────── */}
            {email ? (
              <View style={styles.block}>
                <Text style={styles.h2}>{t('gone.title')}</Text>
                <Text style={styles.dim}>{t('gone.what')}</Text>
                <Pressable style={styles.check} onPress={() => setAlsoLocal(!alsoLocal)} hitSlop={8}>
                  <View style={[styles.box, alsoLocal && styles.boxOn]}>
                    {alsoLocal ? <Text style={styles.tick}>✓</Text> : null}
                  </View>
                  <Text style={styles.dim}>{t('gone.alsoLocal')}</Text>
                </Pressable>
                <Pressable onPress={() => {
                  if (!goneArmed) { setGoneArmed(true); return; }
                  setGoneArmed(false);
                  run(async () => {
                    const ok = await onDeleteAccount(alsoLocal);
                    setMsg(t(ok ? 'gone.done' : 'gone.failed'));
                  });
                }}>
                  <Text style={[styles.act, styles.danger]}>
                    {goneArmed ? t('gone.armed') : t('gone.action')}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {msg ? <Text style={styles.dim}>{msg}</Text> : null}
            <Text style={styles.credit}>{t('account.made')}</Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const Row = ({ children }) => <View style={styles.row}>{children}</View>;
const Act = ({ onPress, children }) => (
  <Pressable onPress={onPress} hitSlop={6}>
    <Text style={styles.act}>{children}</Text>
  </Pressable>
);

/* Firebase가 돌려주는 이유를 사람 말로 옮긴다. **그대로 내보이지 않는다** */
function reason(e) {
  const c = String((e && (e.code || e.message)) || '');
  if (c === 'network') return t('err.network');
  if (c.includes('EMAIL_EXISTS')) return t('err.exists');
  if (c.includes('INVALID_LOGIN') || c.includes('INVALID_PASSWORD')) return t('err.password');
  if (c.includes('WEAK_PASSWORD')) return t('err.weak');
  if (c.includes('INVALID_EMAIL')) return t('err.email');
  if (c.includes('CREDENTIAL_TOO_OLD') || c.includes('TOKEN_EXPIRED')) return t('err.again');
  return t('err.unknown');
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
  row: { flexDirection: 'row', gap: 16, alignItems: 'center', flexWrap: 'wrap' },
  line: { fontSize: 13, color: COLOR.ink },
  dim: { fontSize: 12, color: COLOR.inkFaint, lineHeight: 17 },
  act: { fontSize: 13, color: '#2870ff' },
  actOn: { color: COLOR.ink, fontWeight: '600' },
  danger: { color: '#e0453a' },
  input: {
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLOR.rule,
    fontSize: 13, color: COLOR.ink, paddingVertical: 6,
  },
  check: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  box: {
    width: 15, height: 15, borderWidth: 1, borderColor: COLOR.inkFaint, borderRadius: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { borderColor: COLOR.ink },
  tick: { fontSize: 10, color: COLOR.ink, lineHeight: 13 },
  credit: { fontSize: 11, color: COLOR.inkFaint, marginTop: 4 },
});
