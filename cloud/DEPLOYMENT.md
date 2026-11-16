# Vercel 운영과 배포

## 현재 구성

운영 주소는 https://moa-calendar-eta.vercel.app, 프로젝트는 brian-bc35/moa-calendar, 저장소는 briansong17/moapick-calendar의 main 브랜치입니다. Node.js 24 이상을 사용합니다. 빌드는 npm run build, 정적 결과물은 dist/입니다. HTTP 진입점은 api/index.mjs, 예약 진입점은 api/collect.mjs입니다. 함수 최대 실행 시간은 300초입니다.

instagram-collection 예약은 */15 * * * *입니다. 목표 간격은 15분이며 실제 실행 시각은 Vercel 스케줄링에 따릅니다. 계정별 다음 확인 시각은 Supabase에 별도 저장합니다. 서버는 요청과 예약 호출에 따라 실행하므로 PC 서버를 시작하지 않습니다.

## 기존 프로젝트 변경

1. npm ci로 잠금 파일에 맞춰 패키지를 준비합니다.
2. npm run check와 npm test를 실행합니다.
3. 변경을 커밋하고 git push origin main으로 저장소에 올립니다.
4. 연결된 Git 배포를 확인하거나 npx --yes vercel@65.15.0 --prod --yes --scope brian-bc35로 기존 프로젝트에 배포합니다.
5. 배포 완료 상태, 운영 주소, 빌드 버전과 대표 화면을 확인합니다.

## 새 환경의 SQL 적용 순서

기존 운영을 이어받을 때 프로젝트를 새로 만들거나 SQL을 매번 재실행하지 않습니다. 별도 환경을 구축할 경우 전용 Supabase 프로젝트에서 다음 파일을 순서대로 검토·적용합니다.

1. schema.sql: 기본 테이블, 권한, 제한 및 잠금 함수
2. sessions.sql: 서버 보관 회원 세션
3. calendar-sync.sql: 일정 원본 번호, 등록 ID, 지속 작업 큐
4. event-deletion.sql: 회원별 삭제 기록
5. request-logs.sql: 서버 요청 이력
6. operations.sql: 기기 상태 및 처리 단계
7. test-users.sql: 테스트 설정과 수집 위치
8. preserve-sync-on-reset.sql: 테스트 초기화 시 동기화 작업 유지

rls-test.sql은 접근 규칙 확인용이며 일반 배포 절차에 포함하지 않습니다.

## 연결과 권한

Supabase의 Google 로그인 콜백은 해당 프로젝트의 /auth/v1/callback, 앱 로그인 복귀는 운영 주소의 /auth/callback입니다. 캘린더용 Google OAuth 클라이언트는 운영 주소의 /oauth/google/callback을 사용합니다. 로그인과 캘린더 OAuth는 용도와 승인 범위가 다릅니다. 캘린더는 calendar.app.created 범위로 앱이 만든 보조 캘린더를 사용합니다.

Meta에는 이 프로젝트에 승인된 앱·계정·조회 토큰을 사용합니다. 변수 이름은 루트 .env.example을 참고합니다. OPERATIONS_ADMIN_IDS는 최소 기기 진단, MEMBER_SCHEDULE_ADMIN_IDS는 회원 일정 읽기 화면을 제어합니다. 일반 회원 데이터는 서버 인증과 RLS를 따릅니다. 회원 기록의 운영자 열람은 허용된 지원 목적과 대상 범위에서 진행합니다.

비밀값과 토큰은 Git·문서·브라우저 소스에 넣지 않습니다. .env*, .private-backup/, .vercel/, node_modules/, docs/는 배포 제외 설정을 유지합니다. 암호화 키는 기존 암호화 데이터와 함께 보관합니다.
