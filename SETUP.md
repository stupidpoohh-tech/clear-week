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

## 2. 메일 보낼 곳 정하기

[resend.com](https://resend.com) 가입 → **API Keys**에서 키 하나 발급.

도메인을 따로 붙이지 않으면 발신 주소로 `onboarding@resend.dev`를 쓸 수 있다.
단, 그 경우 **가입할 때 쓴 본인 주소로만** 메일이 간다 — 혼자 쓰는 용도라 문제없다.
나중에 남에게 열려면 도메인 인증이 필요하다.

## 3. 환경 변수 세 개 넣기

**Settings → Variables and Secrets**. 앞의 둘은 Secret으로, 마지막은 일반 변수로 둔다.

| 이름 | 값 | 없으면 |
|---|---|---|
| `RESEND_API_KEY` | Resend 키 | 코드 메일이 안 나간다 |
| `MAIL_FROM` | `onboarding@resend.dev` (또는 `Clear Week <onboarding@resend.dev>`) | 위와 같음 |
| `ALLOWED_EMAILS` | 본인 메일 주소 (쉼표로 여럿) | **서버가 열리지 않는다** |

`ALLOWED_EMAILS`가 비면 일부러 막는다. 없으면 아무 주소로나 코드 메일을 쏠 수 있는
통로가 된다. 혼자 쓰는 물건이므로 닫아 두는 것이 기본값이다.

## 4. 다시 배포

변수를 바꾸면 **재배포해야 반영된다.** Deployments에서 Retry, 또는 아무 커밋이나 푸시.

---

## 확인

1. 앱에서 제목을 0.5초 꾹 누른다 → 서랍이 열린다
2. `로그인` → 메일 주소 → `코드 받기`
3. 메일로 온 여섯 자리를 넣고 `확인`
4. 주소 옆에 `자동으로 맞춰집니다`가 뜨면 된 것이다
5. 다른 기기에서 같은 주소로 로그인하면 그때까지 적은 것이 전부 따라온다

## 안 될 때

앱이 이유를 그대로 말한다. 조용히 실패하지 않는다.

| 화면에 뜨는 말 | 뜻 |
|---|---|
| 서버 저장소가 연결되지 않았습니다 | 1번 — KV 바인딩 이름이 `CLEARWEEK`인지 |
| 서버에 허용 주소가 설정되지 않았습니다 | 3번 — `ALLOWED_EMAILS` 없음 |
| 허용된 주소가 아닙니다 | 그 주소가 `ALLOWED_EMAILS`에 없음 |
| 서버에 메일 설정이 없습니다 | 3번 — `RESEND_API_KEY` 또는 `MAIL_FROM` 없음 |
| 메일을 보내지 못했습니다 | Resend 키가 틀렸거나 발신 주소가 인증 안 됨 |

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

## 6. 캘린더 연결 (Dada Calendar)

Clear Week에 적은 일정이 **Dada Calendar**(`dada-calendar.pages.dev`)에도 생기고,
캘린더에 적은 할 일이 Clear Week에도 생기게 하는 기능입니다 (spec §15).

**값 두 개는 이미 박혀 있습니다** (2026-08-24) — `index.html` 위쪽 `const CAL`에
`apiKey`와 `projectId`. 둘 다 공개돼도 되는 값이라(캘린더 쪽 `.env.example`이
그렇게 적어 두었음, 실제 보안 경계는 캘린더의 `firestore.rules`) 저장소에 두어도
안전합니다. 그래서 **Clear Week 앱을 열면 `내 계정`에 캘린더 줄이 이미 있습니다.**

바꿀 일이 있으면 그 두 줄만 고치고 푸시합니다. Cloudflare Pages가 알아서 다시 배포합니다.

### 6-1. 이어 보기

Clear Week에서 머리말 오른쪽 **사람 표시** → `연결` 줄의 `캘린더 잇기` →
**캘린더 계정의 메일과 비밀번호**를 넣습니다. Clear Week 로그인과는 별개 계정입니다.

이어지면 그 주의 일정이 곧바로 맞춰집니다.

### 6-2. 무엇이 오가나

| | 갑니다 | 안 갑니다 |
|---|---|---|
| Clear Week → 캘린더 | 요일 칸에 새로 적은 항목 | 취소선 · 지운 것 · note 칸 · 요일 아래 메모 |
| 캘린더 → Clear Week | 할 일(TODO) 중 안 끝난 것 | 완료한 것 · 아이디어 · 가계부 · 반복 일정 |

**만들기만 오갑니다.** 한쪽에서 지우거나 고친 것은 다른 쪽에 반영되지 않습니다.
몇 번을 맞춰도 같은 것이 두 번 생기지는 않습니다.

### 6-3. 안 될 때

- **캘린더 줄이 안 보인다** → `index.html` 위쪽 `const CAL`의 두 값이 비어 있습니다. 원래는 채워져 있습니다.
- **"메일이나 비밀번호가 다릅니다"** → 캘린더에 로그인할 때 쓰는 그 계정입니다.
- **"캘린더에 닿지 못했습니다"** → 잠시 뒤 다시. 계속 그러면 `projectId`가 틀렸을 수 있습니다.
- **"다시 연결해 주세요"** → 토큰이 만료됐습니다. 다시 이으면 됩니다.
