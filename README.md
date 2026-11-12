# 모아 — Instagram 이미지 일정 정리

별도 프로젝트의 첫 실행 가능한 버전입니다. 기존 Reelbox 코드·토큰을 사용하지 않습니다.

## 실행

Node.js 24 이상이 필요합니다. 처음 받은 소스에서는 `npm ci`로 Google 공식 인증 라이브러리를 설치합니다.

```powershell
cd 'D:\AI_SW_2026팀플\instagram-calendar'
npm start
```

브라우저에서 http://127.0.0.1:3080 접속. 또는 `start.ps1` 실행.
`.env.local`에 승인받은 OpenAI 키가 저장됩니다. 키를 브라우저, Git, 채팅에 복사하지 않습니다.
선택 설정은 `.env.example` 참고. 기본 모델은 `gpt-5.4-mini`, 하루 분석 요청 상한은 20회입니다.

## 사용 순서

1. Instagram 게시물 이미지 1~3장(PNG/JPG/WebP, 각 3MB 이하)을 업로드합니다.
2. 선택적으로 캡션, 계정, 게시일, 원본 주소를 입력합니다. 주소만으로 자동 수집하지 않습니다.
3. 분석하면 행사·신청·예약 일정을 따로 추출합니다. 이미지와 캡션은 OpenAI API로 전송됩니다.
4. 원문과 비교하고 날짜·시간대·장소를 수정합니다. 불필요한 후보는 제외합니다.
5. 확인란을 선택하고 저장하면 `.ics` 파일을 받을 수 있습니다.

연도가 누락된 날짜는 임의 확정하지 않습니다. 시간대 미표기도 확인이 필요합니다.
현재 검토 화면은 한국(Asia/Seoul)과 UTC를 지원합니다. 종료일은 마지막 날을 포함합니다.
시간을 비우면 종일 일정입니다. 시간이 있는 일정의 종료 시간을 추측하지 않습니다.
이미 지난 날짜는 화면에서 경고합니다. AI 추출은 틀릴 수 있으므로 원문을 확인해야 합니다.

## 구현 범위와 제한

구현: 로컬 웹 화면, 이미지/캡션 분석, 구조화된 일정, 검토/수정, SQLite 기록, 캘린더 파일 수동 내보내기,
Google OAuth 연결·토큰 갱신·전용 캘린더 생성·검토한 일정 등록,
Meta Business Discovery 조회·관찰 계정·60분 주기 수집·중복 분석 방지.

외부 연결 검증은 아직 미완료입니다. 새 Meta 계정 및 Google OAuth 자격증명·사용자 승인 후 실제 계정으로 검증해야 합니다.
미구현: 영상 분석, 여러 사용자 로그인, 행사 취소/삭제 자동 반영, 등록된 일정 자동 수정, 외부 접속.
`.ics` 반복 가져오기 시 캘린더 서비스에 따라 중복될 수 있습니다.
Google 직접 등록은 분석 ID에 연결된 고정 이벤트 ID로 중복을 방지합니다. 등록 후 로컬 결과를 수정하면 덮어쓰기를 차단합니다.
이 버전은 한 PC의 단일 사용자·단일 서버 프로세스용입니다. 외부 공개하지 마세요.

## 비용과 데이터

- 동일 이미지·캡션·메타데이터·모델·프롬프트 버전은 성공한 결과를 재사용합니다.
- 입력 변경 시 새 분석 요청이 됩니다. 자동 재시도하지 않습니다.
- 동시에 한 건만 처리합니다. 하루 상한은 서울 날짜 기준이며 실패도 포함합니다.
- 요청당 출력은 6,000토큰 이하. 상한은 비용 금액 한도가 아니며 OpenAI 결제와 별개입니다.
- 토큰 사용량은 분석 기록의 `usage`에 저장됩니다. 중단 요청의 실제 사용량은 알 수 없습니다.
- `store:false`로 요청합니다. 이는 제공자의 모든 로그/보관 정책을 비활성화한다는 뜻은 아닙니다.
- 이미지 원본은 메모리에서만 처리하고 앱 DB에 저장하지 않습니다. 캡션·메타데이터·분석·수정 결과는 `data/events.sqlite`에 저장됩니다.
- `.env*`, `data/`, `.key-setup/`는 Git 제외. `data/test-poster.png`는 개발용 합성 포스터입니다.
- 백업할 때 서버를 종료한 뒤 `data` 폴더를 복사합니다. 키 파일은 별도로 안전하게 관리합니다.
- 요청 중 서버를 재시작하면 해당 작업은 중단 상태가 됩니다. 재분석은 수동으로 실행합니다.
- 자동 수집 작업은 재시작 시 대기 상태로 복원합니다. 계정별 켜짐/꺼짐과 다음 조회 시간도 DB에 보관합니다.
- 연동 비밀정보는 `data/integrations.enc`에 AES-256-GCM으로 저장합니다. `data/integration.key`도 함께 백업해야 합니다.
  같은 PC 계정이 두 파일을 모두 읽을 수 있으면 복호화할 수 있으므로 OS 계정과 백업의 접근 권한도 관리해야 합니다.

## 검증

`npm test`: 모의 응답 및 HTTP 통합 테스트. 비용 발생 없음.
`npm run smoke:live`: `data/test-poster.png`로 실제 유료 API 호출 1회. 명시적으로 실행할 때만 호출됩니다.

## Google 설정

새 프로젝트: **Moa Instagram Calendar**, ID `astute-helper-514510-d7`.
Calendar API 활성화, OAuth 동의 화면 및 웹 클라이언트 `Moa Local Web` 생성 완료.
본인 Google Cloud 계정을 테스트 사용자로 등록 완료. 요청 범위는 `calendar.app.created`만 등록했습니다.
클라이언트 ID: `179396803727-ofdr1mn43hqmes6el2jjqfrr5ht5edbr.apps.googleusercontent.com`.
사용자가 새 보안 비밀번호를 로컬 앱에 직접 저장했고 OAuth 승인 및 전용 캘린더 `모아 · Instagram 일정` 생성이 완료됐습니다.
실제 일정 등록은 아직 검증하지 않았습니다. 인증 콜백은 외부 리디렉션의 Fetch Metadata가 유지되는 문제를 피하도록 성공 문서와 앱 복귀 링크를 제공합니다.

1. 새 프로젝트에서 Google Calendar API 활성화(약관 동의 필요).
2. Google Auth Platform에서 앱 표시 이름/지원 이메일/개발자 연락처/외부 테스트 사용자를 설정.
3. 웹 애플리케이션 OAuth 클라이언트를 생성. 승인된 리디렉션 URI:
   `http://127.0.0.1:3080/oauth/google/callback`
4. 다운로드한 클라이언트 JSON을 로컬 웹 화면의 Google 설정에 업로드.
5. `Google 계정 연결`에서 `calendar.app.created` 권한 승인 후 전용 캘린더 만들기.
6. 일정 원문 확인 → 로컬 저장 → `Google 캘린더에 등록`.

시간 일정은 Google에서 종료 시점을 요구하므로 종료 시간 입력이 필요합니다. 추측으로 채우지 않습니다.
토큰 갱신은 공식 google-auth-library가 처리합니다. 권한 철회/테스트 자격증명 만료는 다시 연결해야 합니다.
OAuth state + 브라우저 HttpOnly 쿠키 + PKCE를 검증합니다. 계정 연결은 정확히 `127.0.0.1:3080`에서 시작하세요.
캘린더 생성 요청의 응답이 유실되면 중복 생성을 막기 위해 생성 대기 상태로 잠깁니다. 임의 재생성하지 말고 Google에서 먼저 확인하세요.

## Meta 설정 및 수집 범위

기존 Reelbox 계정·앱·토큰을 사용하지 않습니다. 새 프로젝트용 Facebook 계정으로 개발자 화면에 로그인합니다.
새 Meta 앱 `Moa Calendar` 생성 완료. 앱 ID: `2281199932611721`.
새 Facebook 페이지 `Moa Calendar` 생성 및 초기 설정 완료(카테고리: 소프트웨어).
페이지 URL: https://www.facebook.com/profile.php?id=61596149956097
관리 화면 링크에 표시된 asset_id: `1435601266305062` (API 페이지 ID는 토큰 발급 후 조회로 확인 예정).
Instagram `@springintiger` 가입 및 비즈니스 프로페셔널 전환 완료(소프트웨어, 연락처 비공개). 사용자 승인으로 `송해근` 비즈니스 포트폴리오에 추가하고 Facebook 페이지 연결 완료를 확인했습니다.
Instagram 이용 사례의 Facebook Login API 설정 화면까지 확인했습니다.
앱의 조회 권한 `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`, `pages_show_list`가 테스트 준비 완료 상태입니다. 토큰 발급·실제 조회 검증은 미완료입니다.
Facebook 로그인 구성 `Moa Read Only` 생성 완료(ID `3190350967977453`, 일반/사용자 토큰/위 네 권한). Graph API 탐색기에 표시된 버전은 `v27.0`입니다. 토큰 발급과 로컬 저장 승인 대기 중입니다.
Facebook Login 방식의 새 Meta 앱, 본인 Instagram 프로페셔널 계정과 연결된 Facebook 페이지를 준비합니다.
Business Discovery의 권한과 현재 Graph API 버전은 새 앱 화면/공식 문서에서 확인해야 합니다.
초기 설정에서 `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`,
페이지 탐색용 `pages_show_list`가 필요한지 실제 로그인 방식과 역할에 맞춰 확인합니다.
접근 실패는 개인 계정이라는 증거가 아닙니다. 프로페셔널 대상도 권한·연결·앱 접근 수준 문제로 실패할 수 있습니다.

1. 새 앱에서 발급한 액세스 토큰, 본인 Instagram ID, Graph API 버전을 로컬 연결 화면에 입력.
2. 본인 계정 조회 성공 후에만 암호화 저장.
3. 관찰할 공개 계정을 추가. Business Discovery 실제 조회 성공 후 등록됩니다.
4. 계정별 `지금 수집`으로 시험한 후 `자동 수집 켜기` 선택.

자동 수집은 서버가 실행되는 동안 60분 주기. 최초 최근 10개, 이후 최근 30개(최대 3페이지)를 확인합니다.
더 과거 글까지 무제한 수집하지 않으며 범위를 초과하면 화면에 경고합니다. 이 범위보다 많은 글이 올라오면 놓칠 수 있습니다.
한 번에 최대 5개 게시물을 분석하고, 남은 대기는 다음 주기에 처리합니다. 수동 분석과 하루 20회 상한을 공유합니다.
실패 게시물은 최대 3회 시도. 일일 상한 또는 다른 분석 진행 중이면 시도 횟수를 소모하지 않고 대기합니다.
영상은 건너뛰고, 사진 3장 초과 게시물은 일부를 임의 누락하지 않고 수동 확인 대상으로 표시합니다.
이미지 CDN의 단기 서명 URL 변경만으로 AI를 다시 호출하지 않습니다. 캡션/미디어 ID 변경은 재분석합니다.
서로 다른 게시물의 같은 행사인지 의미를 비교하는 중복 감지는 미구현입니다.
게시물 삭제·취소를 자동으로 캘린더 삭제로 해석하지 않습니다. 변경된 추출 결과는 새 검토가 필요합니다.

## 검증 상태

2026-11-12: 기존 기능 및 연동 모의 테스트 총 14개 통과.
OAuth 요청 검증/재연결, 커밋 후 응답 유실 시 중복 생성 방지, 날짜 경계, 암호화 저장,
Meta 권한 오류 분류/CDN 제한/중복 수집/일일 한도 대기를 포함합니다.
실제 Meta 조회·실제 Google 일정 생성은 계정 설정 완료 후 추가 검증해야 합니다.

연동 공식 참고:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/calendar/api/auth
- https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery/

공식 API 참고:
- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/gpt-5.4-mini
