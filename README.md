# 모아픽 캘린더

Instagram 게시물과 업로드 이미지에서 일정을 추출해 회원별 Google 보조 캘린더에 연결하는 웹 서비스입니다. 운영 기준은 Vercel과 Supabase입니다.

- 운영 주소: https://moa-calendar-eta.vercel.app
- Git 저장소: https://github.com/briansong17/moapick-calendar
- Vercel 프로젝트: brian-bc35/moa-calendar
- 상세 설명서: [프로젝트 구조 및 인계](docs/모아픽_프로젝트_구조_및_인계.hwpx)

## 처음 읽을 파일

vercel.json → cloud/build.mjs → api/index.mjs → cloud/handler.mjs 순서로 화면 배포와 서버 진입점을 읽습니다. 자동 수집은 api/collect.mjs, cloud/server-worker.mjs, cloud/collection.mjs를 이어서 읽습니다.

## 코드 확인과 배포

Node.js 24 이상과 npm을 사용합니다. 다음 명령은 빌드와 검사용입니다. PC용 서버는 운영 경로에 포함하지 않습니다.

~~~powershell
cd 'D:\AI_SW_2026팀플\instagram-calendar'
npm ci
npm run check
npm test
~~~

변경을 커밋한 뒤 git push origin main으로 저장소에 올립니다. 기존 Vercel 프로젝트에 직접 배포할 때는 다음 명령을 사용합니다.

~~~powershell
npx --yes vercel@65.15.0 --prod --yes --scope brian-bc35
~~~

처음 인계받은 PC에서는 본인에게 허용된 GitHub·Vercel 계정으로 로그인하고 기존 moa-calendar 프로젝트에 연결합니다. Git 연결 배포를 이용할 때는 연결 저장소와 Production Branch가 main인지 확인합니다. 배포 완료 상태와 운영 주소를 확인합니다.

## 폴더 역할

| 경로 | 역할 |
| --- | --- |
| api/ | Vercel HTTP 요청과 예약 작업 진입점 |
| cloud/ | Supabase 기반 서버, 화면, 빌드, SQL 정의 |
| lib/ | 일정 추출·변환·Instagram 조회의 공통 함수 |
| test/ | 현재 운영 코드의 자동 검사 |
| docs/ | HWPX 프로젝트 설명서 |
| dist/ | 빌드 생성 파일. 직접 수정하지 않음 |
| .private-backup/ | 과거 자료 보관. Git·배포에서 제외 |

## 운영 설정과 처리 흐름

서버는 Vercel Production 환경변수를 사용합니다. 변수 이름은 .env.example에 정리했습니다. 비밀값은 Git·문서·브라우저에 넣지 않습니다. TOKEN_ENCRYPTION_KEY는 기존 암호화 데이터와 함께 유지합니다. SQL 정의와 새 환경 구축 순서는 [배포 안내](cloud/DEPLOYMENT.md)를 참고합니다. 이미 반영된 SQL을 배포할 때마다 다시 실행하지 않습니다.

Google 로그인은 회원 인증이며 Google 캘린더 연결은 별도 승인입니다. 추출 일정은 검토 전 (검토 필요) 표시를 사용하고, 검토 저장은 같은 Google 일정을 갱신합니다. 미래 일정의 추가와 웹 삭제 기록의 Google 반영은 지속 작업 큐로 처리합니다. 웹 방문·화면 복귀와 예약 작업이 각각 서버에 갱신을 요청합니다.

기본 모델은 gpt-5.4-mini, 앱의 일일 분석 상한은 100입니다. 테스트 사용자 수집은 조건을 충족할 때 게시물 최대 1개를 처리합니다. 자세한 파일별 역할과 다른 에이전트 인계 내용은 HWPX 설명서에 있습니다.
