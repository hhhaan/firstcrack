# 로스팅 화면 고도화 명세

## 현재 구현 상태

| 항목 | 파일 | 상태 |
|------|------|------|
| BT / ET / RoR 곡선 | `RoastTempChart.tsx` | 구현됨 |
| Target Curve (점선) | `RoastTempChart.tsx` | 구현됨 |
| Turning Point (TP) | `turningPoints.ts` + chart | 구현됨 |
| Phase 표시 (Drying/Yellowing/Maillard/Dev) | `ActiveRoast.tsx` | 구현됨 |
| FC Start / FC End 마커 | `ActiveRoast.tsx` | 구현됨 (색상 조정 필요) |
| Yellow 마커 | `ActiveRoast.tsx` | 구현됨 |
| Dev Time Ratio (DTR) | `ActiveRoast.tsx` (devTimeStr) | 계산됨, UI 미표시 |
| RoR Smoothing 조절 | — | 미구현 |
| 차트 Toggle 버튼 (인라인) | `ActiveRoast.tsx` | roastSettings 연동됨 (Settings에만 있음) |

---

## 1. 핵심 그래프 지표 명세

| 우선순위 | 영문명 | 한국어명 | 색상 | 현재 색상 | 조치 |
|---------|-------|---------|------|----------|------|
| ★★★★★ | Bean Temperature (BT) | 빈 온도 | `#1F2937` (charcoal) | `colorPrimary` (CSS var) | 유지 |
| ★★★★★ | Environment Temperature (ET) | 환경(드럼) 온도 | `#2563EB` | `rgba(37,99,235,0.7)` | 유지 |
| ★★★★★ | Rate of Rise (RoR) | 상승률 | `#EA580C` | `#d97706` (amber) | **색상 변경 필요** |
| ★★★★★ | Target / Reference Curve | 목표 프로파일 | 연초록 점선 `#10B981` | `rgba(23,23,23,0.25)` | **색상 변경 필요** |
| ★★★★ | First Crack Start | 1차 크랙 시작 | `#166534` (진초록) | `#ea580c` | **색상 변경 필요** |
| ★★★★ | First Crack End | 1차 크랙 종료 | `#16a34a` (초록) | `#dc2626` | **색상 변경 필요** |
| ★★★ | Turning Point (TP) | 전환점 | `#16a34a` | `#16a34a` | 유지 |
| ★★★ | Yellowing End | 옐로잉 종료 | `#ca8a04` | `#ca8a04` | 유지 |

### 색상 팔레트 확정

```
BT:           #1F2937  (진한 charcoal)
ET:           #2563EB  (파랑, 70% opacity)
RoR:          #EA580C  (선명 주황) ← 현재 #d97706에서 변경
Target Curve: #10B981  (초록 점선) ← 현재 charcoal 25%에서 변경
FC Start:     #166534  (진초록) ← 현재 주황에서 변경
FC End:       #16a34a  (초록) ← 현재 빨강에서 변경
Yellow:       #ca8a04  (유지)
경고:          #EF4444  (빨강)
```

---

## 2. 실시간 LiveReadings 지표

### 현재 4개
- Bean Temp (BT)
- Env Temp (ET)
- Rate of Rise (RoR)
- Phase

### 추가 예정 (Phase 2)

| 지표 | 계산 방법 | 현재 데이터 |
|------|----------|------------|
| Development Time Ratio (DTR) | `devSec / elapsed * 100` | 이미 계산됨 (`devTimeStr`) |
| Projected Drop Temp | RoR 추세 외삽 | 신규 계산 필요 |
| RoR at FC Start | FC Start 시점 RoR 스냅샷 | 신규 스냅샷 저장 필요 |

DTR은 `ActiveRoast.tsx:622-629`에서 이미 계산. FC Start 이후에만 표시.

---

## 3. 차트 Toggle 버튼 (인라인)

### 현재 상태
토글은 Settings Modal (`RoastSettingsTab.tsx`) 에만 있음.  
`roastSettings.showET`, `showTargetCurve`, `showRoRChart` → `RoastTempChart`에 연동됨.

### 목표
차트 헤더에 Quick Toggle 버튼 추가:

```
[ET] [Target] [RoR]   ← 현재 Legend 영역에 클릭 가능하게
```

- 토글 상태는 `useRoastSettings` store와 연동 (Settings와 동기화)
- 버튼 클릭 시 즉시 반영

### Preset 모드 (Phase 3 이후)

| 모드 | 표시 지표 |
|------|---------|
| Basic | BT + RoR |
| Pro | BT + ET + RoR + Target |
| Competition | BT + ET + RoR + Target + DTR |
| Full Expert | 전체 |

---

## 4. RoR Smoothing

| 옵션 | 스팬 | 현재 |
|------|------|------|
| 5초 | 5s | — |
| 15초 | 15s | `roastSettings.rorSpanSec` (기본값 설정됨) |
| 30초 | 30s | — |

`RoastSettingsTab.tsx`의 rorSpanSec 슬라이더를 차트 헤더에도 노출.

---

## 5. Batch Report / 분석 지표 (History 화면)

| 지표 | 설명 |
|------|------|
| Batch Consistency Score | 동일 프로파일 배치 간 BT 곡선 편차 |
| Development Time | FC Start → Drop 시간 |
| Dry Phase Time | 0 → Yellowing 시간 |
| Maillard Phase Time | Yellowing → FC Start 시간 |
| Charge Temp | 투입 온도 (BT at t=0) |
| Drop Temp | 종료 온도 (BT at End) |
| Total Roast Time | Charge → Drop |
| Area Under Curve (AUC) | BT 곡선 적분 (로스팅 강도 지표) |
| Crash / Flick Detection | RoR가 FC 전후 급락/급등 감지 |

---

## 구현 계획

### Phase 1 — 색상 수정 (빠름, 1-2h)
**파일**: `RoastTempChart.tsx`, `ActiveRoast.tsx`

1. RoR 색상: `#d97706` → `#EA580C` (chart series + tooltip + right axis stroke)
2. Target Curve 색상: `rgba(23,23,23,0.25)` → `rgba(16,185,129,0.5)` (#10B981)
3. FC Start 마커 색상: `#ea580c` → `#166534`
4. FC End 마커 색상: `#dc2626` → `#16a34a`
5. Legend 텍스트/색상 도트 업데이트

**검증**: 앱 실행 후 그래프 색상 시각 확인

---

### Phase 2 — LiveReadings DTR 추가 (1-2h)
**파일**: `LiveReadings.tsx`, `ActiveRoast.tsx`

1. `ActiveRoast.tsx`에서 `devTimeStr`을 `LiveReadings`에 prop으로 전달
2. `LiveReadings.tsx`에 DTR 카드 추가 (FC Start 이후에만 표시, 이전엔 `—`)
3. 총 5개 카드: BT / ET / RoR / Phase / DTR

**검증**: FC Start 마크 전후 DTR 표시 확인

---

### Phase 3 — 차트 헤더 인라인 Toggle (2-3h)
**파일**: `ActiveRoast.tsx`

1. 현재 Legend 영역을 클릭 가능한 Toggle 버튼으로 교체
2. `roastSettings.showET/showTargetCurve/showRoRChart` setter 연동
3. 활성 상태에 따라 버튼 스타일 변경 (활성: solid, 비활성: faded)

**검증**: 버튼 클릭 시 차트 즉시 업데이트 + Settings Modal 상태 동기화

---

### Phase 4 — RoR Smoothing 노출 (1h)
**파일**: `ActiveRoast.tsx`, `features/active-roast/model/settings.ts`

1. 차트 헤더에 `5s / 15s / 30s` 세그먼트 버튼 추가
2. `roastSettings.rorSpanSec` setter 호출

**검증**: 값 변경 시 RoR 곡선 스무딩 변화 확인

---

### Phase 5 — Batch Report 지표 (History 화면, 별도 이슈)
History 화면 리팩토링 시 함께 진행. 이 명세에서 계획만 기록.

---

## 파일 위치 참조

```
src/views/ActiveRoast.tsx          ← 메인 화면 로직
src/widgets/active-roast/
  ui/RoastTempChart.tsx            ← uPlot 차트
  live-readings/LiveReadings.tsx   ← 실시간 수치 카드
  event-buttons/EventButtons.tsx   ← FC/Yellow 버튼
  roast-log/RoastLog.tsx           ← 이벤트 로그
src/features/active-roast/
  model/settings.ts                ← showET/showRoR/rorSpanSec
  lib/turningPoints.ts             ← TP 감지
  lib/temperature.ts               ← 단위 변환
```
