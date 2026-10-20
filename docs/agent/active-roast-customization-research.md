# Active Roast 사용자 커스텀 조사

조사일: 2026-10-08. 현재 코드와 제품 공식 문서를 비교했다. 아래 우선순위·난이도는 코드 구조를 바탕으로 한 제안이며, 사용자 수요를 검증한 결과는 아니다. 구현 변경은 포함하지 않는다.

## 결론

우선 추가할 것은 **숫자 패널 개인화 → 화면 프리셋 → 자주 쓰는 메모 버튼**이다. 그래프 자체의 설정은 이미 폭넓다. 사용자가 무엇을 보고 어떤 기록을 반복하는지에 맞추는 쪽에 남은 여지가 크다.

## 이미 가능한 것

| 영역 | 현재 사용자 설정 |
| --- | --- |
| 곡선 | 현재/기준 곡선의 채널별 색·굵기·선 종류, ET·RoR·ET RoR·제어 그래프 및 기준 프로파일 채널 표시 |
| 차트 | 온도·RoR·제어 Y축 범위, 시간 범위, 눈금·라벨 간격, 사용자 지정 온도 눈금, 제어 그래프 높이 |
| 가독성 | 차트 내부 글자 배율, 이벤트 마커 방식, Phase bar·FC band 표시, 로그 별도 패널 펼치기 |
| 센서 표시 | BT·ET·BT RoR·ET RoR 평활 강도, RoR 계산 구간 15/30/60초, 갱신 주기 500/1000ms(플랜 제한 존재) |
| 이벤트 | 자동 Charge/Drop 활성화·감도, 자동 Drop 감지 시작 시간, 자동 Yellow·기준 온도, FC Start/Rolling 이중 마킹 |
| 알림 | RoR 하한·BT 상한, Charge 이후·기준 FC/Drop 이전·실제 Drop 이후 시간 알림, 소리 활성화·종류 |
| 배치 사이 | BBP 활성화 |

근거: [설정 모델](../../src/features/active-roast/model/settings.ts), [실제 설정 UI](../../src/widgets/settings/ui/RoastSettingsTab.tsx), [곡선 스타일 UI](../../src/widgets/settings/ui/CurveStyleSection.tsx), [로그 패널](../../src/views/active-roast/ui/RoastSidePanelLayout.tsx).

주의: `showET` 등의 그래프 표시 설정과 오른쪽 숫자 패널 구성은 별개다. 설정 모델의 `pidDropBehavior`는 설정 UI에서 주석 처리되어 있어 현재 사용자에게 제공하는 항목으로 세지 않았다.

## 추가 후보

난이도는 상대 비교다. 일정 추정은 포함하지 않았다.

| 순위 | 후보 | 사용 예 | 현재 빈틈 | 난이도 |
| --- | --- | --- | --- | --- |
| 1 | 숫자 패널 표시·순서·크기 | BT·RoR·Time·DTR을 위로, ET·ΔET 숨김, 중요한 숫자 크게 | 항목 순서·크기와 패널 폭이 고정 | 중 |
| 2 | 이름 있는 화면 프리셋 | `샘플 로스터`, `생산 로스터`, `큰 숫자` 저장·전환 | 축 값의 기본 선택지는 있지만 사용자 설정 묶음 저장은 없음 | 낮음~중 |
| 3 | 자주 쓰는 메모 버튼 | `향 변화`, `연기 증가`, `샘플 확인`을 한 번 눌러 기록 | 자유 메모는 있지만 반복 문구를 등록하는 UI 없음 | 낮음~중 |
| 4 | 사용자 알림 규칙 | `FC 이후 60초`, `BT 190°C 상승 통과`, `DTR 18% 도달` | 정해진 6종 알림만 있고 조건별 규칙 추가 불가 | 중~높음 |
| 5 | 목표 편차 허용 범위 | 기준 BT 대비 ±1/±2/±3°C 표시 기준 | 현재 정상 범위 ±2°C 고정 | 낮음(표시만) |
| 6 | 단축키 재지정 | 익숙한 키로 Yellow·FC·메모 버튼 기록 | `mod+1/2/3`, `mod+D` 등 코드에 고정 | 중 |
| 후속 | 제어 조작 단위 | 지원 장비의 Fan 증감 단위를 1%/5%로 선택 | Fan/Drum 버튼 증감이 단위에 따라 5 또는 1로 고정 | 중 |

### 1. 숫자 패널 개인화

현재 ET → ΔET → BT → ΔBT → 목표 편차 → RoR → Time → Phase → DTR/개발 시간 순서로 렌더링된다. 일부 항목은 로스팅 상태에 따라 나타나지만 사용자가 구성을 고르지는 못한다. 패널은 `w-44`, 주요 숫자는 `text-3xl`이다.

첫 범위는 기존 지표의 표시/숨김, 위·아래 이동, 숫자 크기 2단계로 충분하다. 자유 배치 캔버스보다 설정 목록이 작고 명확하다. 로스팅 조작 버튼·경고 영역은 지표 설정과 분리한다.

근거: [숫자 패널](../../src/views/active-roast/ui/RoastSidePanel.tsx#L117), [패널 폭](../../src/views/active-roast/ui/RoastSidePanelLayout.tsx#L32).

Cropster는 측정값의 크기·순서와 숫자/곡선 표시를 따로 설정한다. Artisan는 BT·ET·RoR 숫자 표시 전환과 별도 Large LCD 창을 제공한다. 이는 패널 개인화의 비교 근거이며, 별도 창까지 첫 범위에 포함해야 한다는 뜻은 아니다. [Cropster Preferences](https://cropsterhelpdesk.helpjuice.com/customization-and-preferences/roasting-intelligence-preferences), [Artisan LCDs](https://artisan-scope.org/docs/lcds/).

### 2. 화면 프리셋

현재 `roast.settings` 한 묶음에 저장되는 표시 설정을 이름을 붙여 보관하고 적용하는 방식이다. 첫 범위는 곡선 스타일·표시 채널·축·글자·패널 구성으로 제한한다. 자동 감지·알림 임계값·장비 제어값은 화면 전환에 함께 섞지 않는다.

센서 평활과 RoR 계산 구간을 포함할지는 별도 결정이 필요하다. 포함하면 같은 데이터도 다르게 보이므로 단순 화면 설정과 구분해 설명해야 한다. 머신 연결 시 자동 적용은 수동 저장·불러오기 수요를 확인한 다음 고려한다.

근거: [설정 저장 키](../../src/features/active-roast/model/settings.ts#L16). Firescope는 차트 설정을 이름으로 저장하고 한 번에 불러오는 기능을 공식 문서로 안내한다. [Firescope 차트 커스텀](https://eng.firescope.cropster.com/posts/customize-your-chart-to-closely-analyze-roasting-curves).

### 3. 메모 버튼

사용자가 버튼 이름과 메모 문구를 등록하고, 기존 `Note` 기록 경로로 시간·온도와 함께 남기는 방식부터 시작한다. 장비 조작 매크로나 새로운 이벤트 종류까지 확장할 필요는 없다.

저장 이벤트의 `type`은 문자열이지만 차트 표시 이벤트는 허용 목록으로 걸러진다. 임의 이벤트 이름만 추가하면 저장되더라도 라이브·히스토리 마커에 나타나지 않을 수 있다. 기존 `Note` 재사용은 이 차이를 피하고 현재 저장·표시 경로를 유지한다.

근거: [메모 기록](../../src/features/active-roast/model/useRoastLog.ts), [차트 이벤트 목록](../../src/features/active-roast/lib/chart-config.ts#L189), [저장·히스토리 변환](../../src/features/active-roast/lib/serialize-roast-events.ts).

Artisan는 사용자 이벤트 버튼의 라벨·설명·색상·표시·순서와 버튼 팔레트 저장을 지원한다. 이 중 기록 버튼을 작은 범위로 가져오는 제안이다. [Artisan Events](https://artisan-scope.org/docs/events/).

### 4. 사용자 알림

기존 기능과 겹치므로 `Charge 후 N분` 같은 항목을 새 기능으로 세지 않는다. 실질적인 추가는 **실제 이벤트 이후 경과 시간**, **온도 상승/하강 통과**, **DTR 도달**, **규칙별 문구·소리**다. 첫 범위는 실제 FC 이후 시간과 BT 통과 조건 정도가 적절하다.

참고로 현재 `FC 이전` 알림은 실제 FC 예측이 아니라 기준 프로파일의 FC 시간에 상대적인 알림이다. 규칙 확장 시 세션별 발화·재발화와 센서 경계값 흔들림 처리를 정의해야 한다. 기존 RoR/BT 알림의 히스테리시스 동작을 보존한다.

근거: [현재 6종 알림과 평가](../../src/features/active-roast/lib/roastAlerts.ts). Cropster는 시간·온도·이벤트 관련 사용자 알림, 상승/하강 방향, 시각/소리 방식과 개별 활성화를 제공한다. [Cropster Smart Alerts](https://cropsterhelpdesk.helpjuice.com/using-roasting-intelligence/using-smart-customizable-alerts).

Artisan는 TP·FC 같은 이벤트 이후 상대 시간 알림과 알림 세트 저장을 지원한다. 실제 FC 이후 시간 알림 제안의 비교 근거다. [Artisan Alarms](https://artisan-scope.org/docs/alarms/).

### 5. 목표 편차와 변화량 구간

목표 BT 편차의 정상 범위는 현재 ±2°C다. 사용자 허용 범위를 설정하는 것은 비교적 작은 확장이다. 표시 색상 기준을 바꾸는 것과 편차 초과 알림을 만드는 것은 별도 기능으로 구분한다.

ΔBT·ΔET는 현재 30초 변화량이다. 15/30/60초 선택도 가능하지만 RoR 계산 구간과 별개의 값이라는 설명이 필요하므로 낮은 우선순위다.

근거: [30초 변화량](../../src/views/active-roast/lib/display-derivatives.ts#L72), [±2°C 정상 범위](../../src/views/active-roast/lib/display-derivatives.ts#L103).

### 6. 단축키와 제어 단위

단축키 재지정은 화면의 키 안내와 실제 동작을 함께 바꾸고 충돌을 검사해야 한다. Drop은 이제 한 번 누르기(`⌘⇧D` 기본)이며, 로스팅 중에는 창이 비활성이어도 기록되도록 OS 전역 단축키로 잡고 로스팅이 끝나면 즉시 놓는다. 모달·세션 상태에 따른 활성화 조건은 그대로다.

장비 제어 단위는 화면 개인화보다 후순위다. 지원 장비의 허용 범위·해상도 안에서 조작 단위만 고르게 하고, 실제 제어 한계를 사용자 설정으로 덮어쓰지 않는다.

근거: [단축키·Drop 전역 등록](../../src/features/active-roast/model/useGlobalDropShortcut.ts), [Fan/Drum 증감 단위](../../src/features/machine-control/ui/ChannelChip.tsx#L41).

목표 허용 범위·ΔBT/ΔET 구간·단축키 재지정은 현재 앱 코드에서 찾은 자체 제안이다. 이번 조사에서 경쟁사의 동일 설정 제공 여부까지 확인하지는 않았다.

## 추천 첫 범위

1. 기존 숫자 지표 표시/숨김·순서·숫자 크기.
2. 현재 화면 설정을 이름으로 저장/적용/삭제, 기본 화면 복원.
3. 기존 `Note`로 남기는 사용자 메모 버튼.

이후 실제 요청에 따라 알림 규칙과 단축키를 확장한다. 드래그 자유 배치, 스크립트 실행, 장비 자동 제어 매크로는 첫 범위에서 제외한다.
