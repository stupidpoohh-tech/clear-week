# 서버 켜기 — 대시보드에서 해야 하는 일

로그인·동기화는 코드만으로는 켜지지 않는다. **아래 넷을 직접 해야 한다.**
하기 전까지 앱은 예전과 똑같이 동작한다 — 로그아웃 상태이고 이 기기에만 저장된다.
서랍(제목 롱프레스)에 `로그인` 버튼이 보이지만 누르면 이유를 말해 준다.

배포는 지금과 같다. `functions/`는 Pages가 같이 배포하므로 **브랜치를 푸시하면 끝난다.**

---

> ### ⚠️ 저장소 루트에 `wrangler.toml`을 두지 말 것
>
> 이 파일이 있으면 Pages가 설정을 그 파일에서만 읽고 **대시보드의
> Bindings·Variables 편집을 잠근다** — `+ Add` 버튼이 회색이 되고
> "Bindings for this project are being managed through wrangler.toml"이 뜬다.
> 아래는 전부 대시보드로 설정하는 방법이므로 그 파일이 없어야 한다.
> 로컬 개발용 견본은 `wrangler.example.toml`에 있고, 쓸 때만 복사해서 쓴다
> (`.gitignore`가 `wrangler.toml`을 막아 둔다).
>
> 이미 잠겨 있다면: 저장소에서 `wrangler.toml`을 지우고 푸시 →
> **배포가 끝나기를 기다린 뒤** 대시보드를 새로고침하면 풀린다.

> ### Production / Preview
>
> 바인딩과 변수는 **Production에만 걸려 있어도 동작한다.**
> `clear-week.pages.dev`가 Production이기 때문이다.
> Preview는 다른 브랜치를 미리 볼 때 생기는 임시 주소용이라, 지금은 없어도 된다.
> 대시보드가 환경을 나눠 묻지 않으면 그대로 두면 된다.

## 1. KV 네임스페이스 만들기 · 묶기

Cloudflare 대시보드 → **Storage & Databases → KV → Create**

- 이름: 아무거나 (`clear-week` 권장)

그다음 **Workers & Pages → clear-week → Settings → Bindings → Add → KV namespace**

| 항목 | 값 |
|---|---|
| Variable name | `CLEARWEEK` ← **이 이름이어야 한다** |
| KV namespace | 방금 만든 것 |

Production과 Preview **양쪽에** 걸어 둔다.

## 2. 로그인 (Firebase Auth)

**이제 로그인은 캘린더와 같은 계정을 쓴다** (2026-08-24, spec §11). 이 앱에서 로그인하면
Dada Calendar에도 그 순간 이어진다. 별도 설정 없다 — `index.html` 위쪽 `CAL.apiKey`·
`projectId` 두 값이 이미 박혀 있고, 그것이 로그인 뿌리다.

**서버(이 KV)는 로그인에 관여하지 않는다.** 요청마다 실려 오는 Firebase ID token을
서버가 스스로 검증해 email을 뽑는다 (`firebaseEmail()`). 세션 쿠키·메일 발송·허용
목록이 사라졌으므로 아래 환경변수도 필요 없다.

이전에 걸어 뒀다면 **`RESEND_API_KEY`·`MAIL_FROM`·`ALLOWED_EMAILS`는 지워도 된다** —
없어도 아무 일도 안 일어난다.

## 3. 다시 배포

KV를 바꾸면 **재배포해야 반영된다.** Deployments에서 Retry, 또는 아무 커밋이나 푸시.

---

## 확인

1. 앱에서 머리말 오른쪽 **사람 표시** → 서랍이 열린다
2. `로그인` → 메일 주소 → 비밀번호 → `확인`
3. **없는 계정이면 자동으로 만들어진다** (여섯 자 이상)
4. 주소 옆에 `자동으로 맞춰집니다`가 뜨면 된 것이다
5. 캘린더(`calendar-x.pages.dev`)에서도 같은 계정으로 로그인돼 있다
6. 다른 기기에서 같은 주소로 로그인하면 그때까지 적은 것이 전부 따라온다

## 안 될 때

앱이 이유를 그대로 말한다. 조용히 실패하지 않는다.

| 화면에 뜨는 말 | 뜻 |
|---|---|
| 비밀번호가 다릅니다 | 그 주소는 있지만 비밀번호가 어긋남 |
| 비밀번호는 여섯 자 이상 | Firebase의 최소 길이 |
| 잠시 뒤에 다시 해 주세요 | 짧은 시간에 너무 많이 시도됨 (Firebase가 잠시 막음) |
| 이메일/비밀번호 로그인이 꺼져 있습니다 | Firebase 콘솔에서 그 방식이 꺼져 있음 |
| 연결 안 됨 | 서버(KV) 쪽 문제 — 로그인은 됐는데 주 저장이 안 됨 |
| 캘린더에 닿지 못했습니다 | 로그인은 됐는데 캘린더 왕복만 실패 (일시적) |

**로그인 버튼이 아예 안 뜨면** `index.html`의 `CAL.apiKey`·`projectId`가 비어 있는 것이다.
원래는 채워져 있다.

**Firebase 콘솔에서 미리 해 둘 것 하나** — Authentication → Settings → 승인된 도메인에
`clear-week.pages.dev`가 있어야 로그인이 된다. 없으면 콘솔에 `auth/unauthorized-domain`이
찍히고 앱은 조용히 실패한다.

## 로컬에서 서버까지 돌려 보기

```
cp wrangler.example.toml wrangler.toml     # 커밋하지 말 것 (.gitignore가 막는다)
npx wrangler pages dev .
```

`wrangler.toml`의 KV id를 채워야 한다. 비밀값은 `.dev.vars`에 둔다 (역시 커밋하지 않는다).
**다 쓰면 `wrangler.toml`을 지운다** — 남겨 두고 푸시하면 대시보드가 잠긴다.

## 5. 방문자 행동로그 켜기 (선택)

> **지금은 5-1(방문 통계)만 켜 두면 된다.** 행동로그는 `index.html`에서 꺼 놨다
> (`LOG.enabled = false`) — 읽으려면 터미널이 필요해서다 (spec §14).
> **5-2 이하는 그 한 줄을 `true`로 되돌릴 때 하면 된다.**
> 켜지도 않을 거면 **Bindings의 `CLEARWEEK_LOG`는 지워 두는 게 좋다** —
> 계정에서 Analytics Engine을 안 켜면 그 바인딩 하나가 배포를 통째로 막는다.

**안 해도 앱은 완전히 동작한다.** 안 묶으면 서버가 조용히 버리고,
앱은 한 번 두드려 본 뒤 스스로 그만둔다 (spec §14).

### 5-1. 방문 통계 — 클릭 한 번, 코드 없음

**Workers & Pages → clear-week → Settings → Web Analytics → Enable.**
다음 배포 때 Cloudflare가 알아서 비컨을 넣는다. 저장소에서 고칠 것은 없다.
쿠키를 쓰지 않고 사람을 따라다니지 않는다. 방문 수·유입·기기·나라까지 보여 준다.

**여기서 커스텀 이벤트는 못 본다.** 쿠키도 클라이언트 상태도 없어서
개별 행동을 따라갈 수 없다. 그래서 행동로그는 아래를 따로 켠다.

### 5-2. 행동로그 — 계정에서 먼저 켠다

⚠️ **이 단계를 건너뛰면 배포가 통째로 실패한다.** 데이터셋만 안 들어오는 게
아니라 **사이트 갱신이 멈춘다** — Pages가 함수를 올리다 막히기 때문이다:

```
Error: Failed to publish your Function.
Got error: You need to enable Analytics Engine.
```

Analytics Engine은 계정마다 **한 번 켜 줘야** 쓸 수 있다(베타 신청 성격).
바인딩을 먼저 걸고 안 켜 두면 그 순간부터 배포가 전부 빨간불이 된다.
**켜는 것이 먼저, 바인딩이 나중이다.**

1. `https://dash.cloudflare.com/<계정ID>/workers/analytics-engine` 로 간다
   (Workers & Pages → 왼쪽 **Analytics Engine** 으로도 같은 데가 나온다)
2. **Enable / Set up** 버튼을 누른다. 한 번이면 끝이고 돈은 안 든다.

**배포가 이미 실패해 있다면** 사이트는 마지막으로 성공한 배포를 계속 내보내고
있다 — 즉 **최근에 고친 것이 아직 안 올라가 있다.** 켠 뒤 Deployments에서
**Retry deployment**를 눌러 초록불을 먼저 되찾을 것.

켜는 것이 막히면(계정에 따라 안 보이거나 403이 나는 경우가 있다)
**바인딩을 지우면 배포는 곧바로 초록불이 된다.** 로그만 없을 뿐 앱은 멀쩡하다.

### 5-3. 행동로그 — 데이터셋 묶기

**Workers & Pages → clear-week → Settings → Bindings → Add → Analytics Engine.**

| 칸 | 값 |
|---|---|
| Variable name | `CLEARWEEK_LOG` |
| Dataset | `clearweek_log` |

이름 둘 다 정확해야 한다. `CLEARWEEK_LOG`는 코드가 찾는 이름이고
(`functions/api/log.js`), `clearweek_log`는 읽을 때 쓰는 표 이름이다
(`tools/stats.mjs`). **묶은 뒤 다시 배포해야 적용된다.**

데이터셋은 미리 만들지 않는다 — 첫 이벤트가 도착할 때 저절로 생긴다.

### 5-4. 읽을 토큰 만들기

**My Profile → API Tokens → Create Token → Create Custom Token.**

| 칸 | 값 |
|---|---|
| Permissions | `Account` · `Account Analytics` · `Read` |
| Account Resources | 이 계정 |

계정 ID는 Workers & Pages 오른쪽 사이드바에 있다.

```
export CF_ACCOUNT_ID=…
export CF_API_TOKEN=…
node tools/stats.mjs                 # 최근 14일
node tools/stats.mjs --days 30
```

**내 기기는 빼고 보는 게 좋다** — 안 그러면 통계가 자기 자신이다.
앱을 연 브라우저 콘솔에서 `localStorage['clearweek:did']`를 찍어 두고:

```
export CW_LOG_EXCLUDE=기기ID1,기기ID2
```

### 5-5. 끄고 싶으면

- **잠깐 끄기**: 대시보드에서 Bindings의 `CLEARWEEK_LOG`를 지운다. 앱은 그대로 돈다.
- **아예 끄기**: `index.html`의 `LOG.enabled = false`.
- 쓰는 사람이 브라우저에서 추적 거부(DNT·GPC)를 켜 두면 애초에 안 보낸다.

## 돈

KV 무료 한도는 하루 읽기 10만·쓰기 1천이다. 한 사람이 두 기기로 쓰면
하루 수백 번 수준이라 한참 남는다. Resend 무료 한도도 로그인 메일 몇 통에는 넉넉하다.

Analytics Engine 무료 한도는 하루 쓰기 10만·읽기 1만이고 **90일까지 보관**한다.
한 사람이 하루에 내는 이벤트가 수십 개 수준이라, 하루 수백 명이 와도 남는다.
90일이 지난 것은 사라지므로, 오래 두고 볼 숫자가 있으면 그전에 따로 적어 둔다.
Web Analytics는 한도가 따로 없다.

---

## 6. 캘린더 (Dada Calendar) — 로그인의 일부

Clear Week에 적은 일정이 **Dada Calendar**(`calendar-x.pages.dev`)에도 생기고,
캘린더에 적은 할 일이 Clear Week에도 생기게 하는 기능입니다 (spec §15).

**별도로 할 것이 없습니다** (2026-08-24). 2번에서 로그인하면 그 순간 이 기능도
켜집니다 — 두 앱이 같은 Firebase 계정을 씁니다 (spec §11).

### 6-1. 무엇이 오가나

| | 갑니다 | 안 갑니다 |
|---|---|---|
| Clear Week → 캘린더 | 요일 칸에 새로 적은 항목 | 취소선 · 지운 것 · note 칸 · 요일 아래 메모 |
| 캘린더 → Clear Week | 할 일(TODO) 중 안 끝난 것 | 완료한 것 · 아이디어 · 가계부 · 반복 일정 |

**만들기만 오갑니다.** 한쪽에서 지우거나 고친 것은 다른 쪽에 반영되지 않습니다.
몇 번을 맞춰도 같은 것이 두 번 생기지는 않습니다.

### 6-2. 안 될 때

- **로그인 자체가 안 보인다** → `index.html` 위쪽 `const CAL`의 두 값이 비어 있습니다. 원래는 채워져 있습니다.
- **"캘린더에 닿지 못했습니다"** → 잠시 뒤 다시. 계속 그러면 `projectId`가 틀렸을 수 있습니다.
- **로그인은 됐는데 캘린더 항목이 안 온다** → 캘린더에 그 계정으로 만든 항목이 이번 주에 없거나, 저쪽에서 이미 `done`으로 표시된 것들입니다.
