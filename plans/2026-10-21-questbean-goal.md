# 퀘스트빈 10월 21일 기능 구현 계획

목표: 같은 프로파일의 배치를 제목과 번호로 식별하고, 실시간 로스팅을 계속 진행하면서 레퍼런스 기록을 조회하며, 색도 평균·비교와 BBP·수동 조작 기록을 구현한다. 기능별 독립 PR로 제출한다.

상위 에픽: [#979](https://github.com/hhhaan/firstcrack/issues/979). 기준 코드: `b26d65020802082d71d46111bd26fd89deb6b103`. 출처: 2026-10-21 10:20 KST 통화와 후속 사용자 결정. 연락처는 포함하지 않는다.

사용자가 승인한 `plans/` 계획 파일이다. 현재 실행 환경에 별도 `/goal` 명령 정의는 없으며 명령 실행으로 표현하지 않는다. 후속 전체 구현 목표에 따라 계획 이후 제품 구현·독립 PR까지 진행한다.

## 결정과 요구사항

| ID | 요구사항 | 기준 |
| --- | --- | --- |
| R01 | 프로파일별 누적 배치 번호를 제목에 자동 입력하고 히스토리에 저장 | 기존 기기·작업공간·프로파일의 Charge 누적 유지. #986 정책 반영 |
| R02 | 전체 누적 배치 번호도 표시 | 추가 제안 |
| R03 | 자동 제목의 번호 구성을 설정 | 추가 제안 |
| R04 | 로스트 비교에 ET·ET RoR 표시 | 잠정 항목. 기존 #943·#952 재사용 |
| R05 | 로스트 비교에 저장된 색도 표시 | 반영 |
| R06 | 쉼표로 여러 측정값을 입력하고 평균을 소수점 둘째 자리까지 표시 | 반영 |
| R07 | 로스팅 중 생두 변경 | 반영 |
| R08 | 로스팅 중 제목 입력·수정 | 반영 |
| R09 | 실시간 로스팅 중 RoastLog에서 레퍼런스 프로파일 기록 조회 | 현재/레퍼런스 전환, 변경 시간·당시 온도·화력 설정값 |
| R10 | 레퍼런스 화력 변경 시점을 그래프에 흐리게 표시 | 반영 |
| R11 | BBP에서 수동 이벤트 등록 | 반영 |
| R12 | 수동 화력·배기값을 마커와 계단형 그래프로 표시 | 다음 입력까지 직전 값 유지 |
| R13 | 그래프 표시 항목과 자동·수동 데이터 적용 설정 | 후순위 |

- 번호는 기존 기기·작업공간·프로파일의 Charge 누적을 유지한다. 취소·폐기도 번호를 사용하고 동일 세션 복구·Drop 취소는 재할당하지 않는다. 전체 번호는 기존 프로파일 카운터 합계에서 이어가며 날짜별 리셋·과거 기록 재번호화는 하지 않는다.
- 제목은 로스팅 중 직접 편집할 수 있다. 직접 편집한 제목이 자동 제목보다 우선하고 빈 제목은 자동 제목으로 돌아간다. 번호 구성 설정은 다음 배치부터 적용한다. 생두와 레퍼런스의 이름·연결을 별도로 보존한다.
- 비교 채널은 ET·ET RoR 잠정안이다. 기존 #943·#952에서 실제 저장된 채널만 사용한다.
- 색도 평균은 소수점 둘째 자리까지다. 쉼표 입력과 가변 측정 횟수를 지원한다.
- BBP에서 이벤트를 등록한다. 기존 BBP는 다음 Charge의 세션에 속한다.
- 프로파일 기록은 과거 화력 조작 기록이며 현재 Replay 계획과 구분한다.
- R13 설정은 후순위다. R02·R03은 전체 구현에서 선택 옵션으로 제공하며 기본 동작과 정책을 먼저 정한다.

## 기능별 이슈와 PR 경계

| 기능 | 상위 이슈 | PR 경계 |
| --- | --- | --- |
| 프로파일 누적 번호의 자동 제목·히스토리 보존 | [#980](https://github.com/hhhaan/firstcrack/issues/980) | 기능별 구현·수용 기준·검증 결과를 분리 |
| 로스팅 중 제목·생두 편집 | [#981](https://github.com/hhhaan/firstcrack/issues/981) | 기능별 구현·수용 기준·검증 결과를 분리 |
| 저장된 색도와 ET 계열 비교 통합 | [#982](https://github.com/hhhaan/firstcrack/issues/982) | 기능별 구현·수용 기준·검증 결과를 분리 |
| 다중 색도 측정값 입력·평균 계산 | [#983](https://github.com/hhhaan/firstcrack/issues/983) | 기능별 구현·수용 기준·검증 결과를 분리 |
| 실시간 로스팅 중 레퍼런스 기록 조회 | [#984](https://github.com/hhhaan/firstcrack/issues/984) | 기능별 구현·수용 기준·검증 결과를 분리 |
| BBP 이벤트 입력과 수동 조작값 계단형 그래프 | [#985](https://github.com/hhhaan/firstcrack/issues/985) | 기능별 구현·수용 기준·검증 결과를 분리 |

서로 다른 기능 변경을 하나의 PR에 모으지 않는다. 공통 변경은 선행 PR 또는 기존 계약으로 분리하며 각 PR 설명에 의존성을 명시한다. ET 비교 기존 작업을 중복 구현하지 않는다.

## 실행 단계

### 1 정책과 데이터 경계

- [#986](https://github.com/hhhaan/firstcrack/issues/986): 번호 집계·부여 시점·취소/삭제·프로파일 미선택·자동 제목과 직접 편집의 우선권을 정한다. 현재 Charge 카운터 정책과 호환성을 우선한다.
- [#997](https://github.com/hhhaan/firstcrack/issues/997): BBP 경과시간, Charge 상대 시간, 다음 세션 귀속·복구를 정의한다.
- #943·#952: ET·ET RoR 저장·표시 범위를 확인한다.

완료 조건: 구현에 필요한 정책이 이슈에 기록되고, 기존 번호·과거 기록·BBP 경계를 소급해서 재해석하지 않는다.

### 2 저장과 입력

- [#987](https://github.com/hhhaan/firstcrack/issues/987) → [#988](https://github.com/hhhaan/firstcrack/issues/988): 번호 보존과 자동 제목·히스토리 연결.
- [#989](https://github.com/hhhaan/firstcrack/issues/989), [#990](https://github.com/hhhaan/firstcrack/issues/990): 진행 중 메타데이터 편집.
- [#991](https://github.com/hhhaan/firstcrack/issues/991) → [#992](https://github.com/hhhaan/firstcrack/issues/992): 다중 입력·평균·저장·재조회.

완료 조건: 저장·복구·재조회에서 배치 제목·번호·원료와 색도 결과가 유지된다.

### 3 실시간 조회와 수동 기록

- [#994](https://github.com/hhhaan/firstcrack/issues/994) → [#995](https://github.com/hhhaan/firstcrack/issues/995): RoastLog 조회 전환과 상세 표시.
- [#994](https://github.com/hhhaan/firstcrack/issues/994) → [#996](https://github.com/hhhaan/firstcrack/issues/996): 같은 레퍼런스 변경 기록의 흐린 그래프 표시.
- [#997](https://github.com/hhhaan/firstcrack/issues/997) → [#998](https://github.com/hhhaan/firstcrack/issues/998), [#999](https://github.com/hhhaan/firstcrack/issues/999): BBP 이벤트 입력·저장과 계단형 그래프.

완료 조건: 레퍼런스 조회 중에도 현재 수집·시간·제어·기록이 계속된다. BBP 이벤트가 올바른 세션에 저장되고 수동 값은 다음 변경까지 유지된다.

### 4 비교와 통합 검증

- [#992](https://github.com/hhhaan/firstcrack/issues/992) → [#993](https://github.com/hhhaan/firstcrack/issues/993): 각 로스팅의 색도 평균을 비교 카드에 표시.
- [#1000](https://github.com/hhhaan/firstcrack/issues/1000): 현재/레퍼런스, 자동/수동 머신, 저장/복구/재열기, 라이트/다크·좁은 창을 검증한다.
- 각 구현 PR은 관련 단위·통합 테스트와 UI 확인 결과를 기록한다. 저장 계약을 변경하면 해당 서버/로컬 경계도 검증한다. push 전 저장소 필수 검사를 실행한다.

완료 조건: 기능별 완료 기준과 필수 검사가 통과하고 독립 PR 링크가 상위 이슈에 연결된다. 배포·실기 검증은 PR 생성 및 모의 검증과 구분해 기록한다.

### 5 후순위 옵션

- [#1001](https://github.com/hhhaan/firstcrack/issues/1001): 전체 누적 번호.
- [#1002](https://github.com/hhhaan/firstcrack/issues/1002): 제목의 번호 구성 설정.
- [#1003](https://github.com/hhhaan/firstcrack/issues/1003): 그래프 표시 항목 및 자동/수동 데이터 적용 설정. 사용자 지정 후순위로 핵심 기능 다음에 구현한다.

## 세부 작업과 의존성

| 이슈 | 작업 | 선행 | HTML 화면 |
| --- | --- | --- | --- |
| [#986](https://github.com/hhhaan/firstcrack/issues/986) | 누적 번호·자동 제목 정책 확정 | 독립 착수 | `live` |
| [#987](https://github.com/hhhaan/firstcrack/issues/987) | 현재 배치 번호를 세션 기록에 보존 | [#986](https://github.com/hhhaan/firstcrack/issues/986) | `history` |
| [#988](https://github.com/hhhaan/firstcrack/issues/988) | 번호 포함 자동 제목을 히스토리에 표시 | [#987](https://github.com/hhhaan/firstcrack/issues/987) | `history` |
| [#989](https://github.com/hhhaan/firstcrack/issues/989) | 진행 중 생두 선택·저장 허용 | 독립 착수 | `live` |
| [#990](https://github.com/hhhaan/firstcrack/issues/990) | 진행 중 제목 입력·편집 UI | [#986](https://github.com/hhhaan/firstcrack/issues/986) | `live` |
| [#993](https://github.com/hhhaan/firstcrack/issues/993) | 세션별 홀빈·분쇄 색도 표시 | [#992](https://github.com/hhhaan/firstcrack/issues/992) | `compare` |
| [#991](https://github.com/hhhaan/firstcrack/issues/991) | 쉼표 다중 숫자 입력·검증 | 독립 착수 | `history` |
| [#992](https://github.com/hhhaan/firstcrack/issues/992) | 평균 소수점 2자리 표시·저장·재조회 | [#991](https://github.com/hhhaan/firstcrack/issues/991) | `history` |
| [#994](https://github.com/hhhaan/firstcrack/issues/994) | 선택한 레퍼런스의 화력 기록 조회 연결 | 독립 착수 | `live` |
| [#995](https://github.com/hhhaan/firstcrack/issues/995) | 실시간 진행 중 현재·프로파일 기록 전환 | [#994](https://github.com/hhhaan/firstcrack/issues/994) | `live` |
| [#996](https://github.com/hhhaan/firstcrack/issues/996) | 레퍼런스 화력 변경 마커 표시 | [#994](https://github.com/hhhaan/firstcrack/issues/994) | `live` |
| [#997](https://github.com/hhhaan/firstcrack/issues/997) | 이벤트 시간축·투입 경계 저장 규칙 | 독립 착수 | `bbp` |
| [#998](https://github.com/hhhaan/firstcrack/issues/998) | 대기 중 화력·배기 이벤트 입력·저장 | [#997](https://github.com/hhhaan/firstcrack/issues/997) | `bbp` |
| [#999](https://github.com/hhhaan/firstcrack/issues/999) | 수동 화력·배기 이벤트를 계단형으로 표시 | [#997](https://github.com/hhhaan/firstcrack/issues/997) | `live` |
| [#1000](https://github.com/hhhaan/firstcrack/issues/1000) | 기능 간 연동 검증 | 기능별 상위 이슈 | 전체 |
| [#1001](https://github.com/hhhaan/firstcrack/issues/1001) | 전체 누적 번호 옵션 | 번호 정책 | `settings` |
| [#1002](https://github.com/hhhaan/firstcrack/issues/1002) | 자동 제목 구성 옵션 | 자동 제목·전체 번호 정책 | `settings` |
| [#1003](https://github.com/hhhaan/firstcrack/issues/1003) | 그래프 표시·데이터 소스 설정 | 기본 수동 그래프 | `settings` |

## 변경 UI HTML

- [단일 HTML 시안](https://github.com/hhhaan/firstcrack/blob/docs/questbean-20261021-plan-ui/docs/ui/questbean-20261021/index.html)
- 저장소 파일: `docs/ui/questbean-20261021/index.html`
- 로스팅: 진행 중 제목·생두 편집, 현재/프로파일 RoastLog 전환, 레퍼런스 화력 마커, 수동 계단형 그래프.
- BBP: 화력·배기 이벤트 입력과 시점·온도·설정값 목록.
- 히스토리·색도: 번호 포함 제목, 홀빈·분쇄 다중 입력과 평균.
- 로스트 비교: 채널 선택과 세션별 색도 결과.
- 설정: 후순위·추가 옵션의 미리보기.

외부 라이브러리와 서버 없이 열리는 단일 파일이다. 시안의 로컬 저장은 검토용이며 제품의 서버 저장·실기 제어 검증과는 별도다.

## 시안 검증 결과

2026-10-21 Chromium에서 8개 동작 그룹 통과, 페이지 오류 0건. 로그 조회 중 실시간 타이머 유지, 프로파일 전환·빈 상태·마커 토글, 진행 중 제목·생두 편집, 색도 입력 검증·두 자리 평균·재조회, 비교 채널·색도 연동, BBP 등록, 후순위 설정 미리보기, 라이트/다크 및 390px 5개 화면의 가로 넘침을 확인했다.

## 추적 방식

새 이슈 25개: 에픽 1개, 기능별 상위 6개, 세부 작업 14개, 통합 검증 1개, 옵션 3개. 상위 체크리스트와 세부 이슈 역링크로 연결했다. 연결 도구가 GitHub 네이티브 sub-issue 관계 쓰기를 제공하지 않아 해당 관계는 미등록 상태다.


## 제품 구현과 검증

기능별 브랜치는 모두 위 main 커밋에서 독립 작성했다. 관련 기능의 데이터 계약과 UI를 같은 PR에서 검토한다. ET·ET RoR는 main의 기존 구현을 재사용한다.

| PR | 구현 | 요구사항 |
| --- | --- | --- |
| [#1005](https://github.com/hhhaan/firstcrack/pull/1005) | 다중 색도 입력·평균·비교 카드 | R05·R06 |
| [#1006](https://github.com/hhhaan/firstcrack/pull/1006) | 진행 중 생두·블렌드 수정 | R07 |
| [#1007](https://github.com/hhhaan/firstcrack/pull/1007) | 현재/레퍼런스 기록 조회·화력 마커 | R09·R10 |
| [#1008](https://github.com/hhhaan/firstcrack/pull/1008) | 누적 번호·자동 제목·직접 편집·구성 설정 | R01·R02·R03·R08 |
| [#1010](https://github.com/hhhaan/firstcrack/pull/1010) | BBP 이벤트 보존·수동 계단형 그래프·소스 설정 | R11·R12·R13 |

BBP 이벤트는 기존 BBP TSV의 `# bbp_events` 메타데이터에 보존하고 다음 Charge 세션에 귀속한다. 라이브 BBP 경과시간과 저장 후 Charge 이전의 음수 표시시간을 구분한다. FIFO 경계 이전의 마지막 수동 값은 그래프 상태로 이어가며 이벤트를 새로 만든 것으로 표시하지 않는다. 히스토리와 진행 화면에서 BBP 마커를 읽을 수 있고, 같은 탭 복구와 배치 전환 시 입력창 폐기를 처리한다. `roast_sessions.events`에는 음수 BBP 이벤트를 넣지 않아 기존 저장 RPC 계약을 유지한다. DB 변경은 없다.

수동 값은 별도 관찰 기록이며 장비 명령을 실행하지 않는다. 다음 입력까지 직전 값과 0을 유지한다. 자동 우선은 수집값이 없는 채널만 수동 기록으로 보완하고 수동·둘 다 모드도 제공한다. 기존 채널별 표시 설정을 재사용한다.

단일 HTML 시안은 Chromium 8개 동작 그룹, 실제 소스 컴포넌트는 별도 브라우저 5개 그룹을 통과했다. 실제 컴포넌트 확인 범위는 로그 전환 중 BBP 기록 추가·0 보존, BBP TSV 메타데이터 생성, 색도 두 자리 평균, 번호/데이터 소스 설정, 라이트·다크·390px 표시다. 페이지 오류는 0건이다. 프로덕션 빌드와 번들 예산 검사도 통과했다. 최종 통합 `pnpm verify:all`도 통과했다. 프런트엔드 2,821개·사이드카 726개 테스트가 통과했고 기존 제외 항목은 각각 1개·3개다. 결과와 실제 검증 범위는 #1000에 기록했다.

서버 실데이터 저장과 물리 장비 운전은 수행하지 않았다. GitHub 원격 CI는 단계 기록 없이 실패한 실행이 확인되어 로컬 검증과 별도로 표시한다. PR 생성은 병합·배포를 포함하지 않는다.
