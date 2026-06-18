# DESIGN.md: First Crack Desktop

**프로젝트:** 로스터리 관리를 위한 데스크탑 애플리케이션 (Tauri v2 + React)

---

## Design Philosophy

미니멀하고 차분한 엔터프라이즈 감성. 높은 가독성과 정확한 수치 표현이 핵심. 장시간 사용하는 도구이므로 눈의 피로를 최소화하고, 데이터에 집중할 수 있도록 장식은 배제한다.

- **분위기:** 조용하고 정확한, 장인적인
- **키워드:** 미니멀, 저대비, 따뜻한 중성톤, 정밀함
- **No emoji** — 모든 아이콘은 Lucide 사용
- **No gradients** — 단색 + 미세한 그림자 레이어로 깊이감 표현

---

## Design Tokens

### Colors

CSS 변수는 `src/App.css`의 `@theme` 블록에 정의되어 있음.

| 역할 | Light | Dark | 용도 |
|---|---|---|---|
| `--color-main-bg` | `#ffffff` | `#1a1a1a` | 페이지/카드 배경 |
| `--color-roast-bg` | `#ffffff` | `#181d21` | 로스팅 화면 전용 배경 |
| `--color-surface` | `#efeff0` | `#222222` | 버튼/인풋/서피스 배경 |
| `--color-surface-warm` | `rgba(245,242,239,0.8)` | `rgba(30,28,26,0.8)` | 따뜻한 톤 서피스 (호버 등) |
| `--color-surface-warm-solid` | `#f5f2ef` | `#1e1c1a` | 따뜻한 톤 서피스 (불투명) |
| `--color-primary` | `#171717` | `#e5e5e5` | 주요 텍스트 |
| `--color-secondary` | `#4e4e4e` | `#a3a3a3` | 보조 텍스트 |
| `--color-muted` | `#777169` | `#8a8580` | 덜 중요한 텍스트, 플레이스홀더 |
| `--color-border` | `#e5e5e5` | `#2e2e2e` | 테두리 |
| `--color-border-subtle` | `rgba(0,0,0,0.05)` | `rgba(255,255,255,0.08)` | 매우 미세한 테두리 |
| `--color-divider` | `#efeff0` | `#6c6a6b` | 구분선 |

### Point Color Palette (Accent Colors)

프로젝트 전반에서 강조, 시각적 구분, 브랜딩에 사용하는 포인트 컬러. 필요에 따라 Light/Dark 모드에서 동일하게 사용하거나 명도만 조정한다.

| Hex | 역할 예시 |
|---|---|
| `#0B0B0B` | 진한 검정 — 다크 배경, 강한 대비 강조, Danger 위상 (대비용) |
| `#FFFF54` | 밝은 노랑 — Rate of Rise 라인 (dark), Drying 위상 / Yellow 마커 / Heat 라인 |
| `#81FBA5` | 민트 그린 — Ready 위상 / TP 마커 / 연결 상태 도트 / 현재 시간 라인 |
| `#72EBBC` | 청록 민트 — Note 마커 / Drum 온도 라인 / Default 프로필 배지 |
| `#44BFFC` | 밝은 파랑 — FC Start 마커 / Maillard 위상 / Fan 라인 / 진행중 배지 / 첫번째 배치 번호 |
| `#5C41FF` | 진한 보라 — Delete 액션 배지 / KPI 부정 변화 |
| `#756AFC` | 연한 보라 — FC End 마커 / Development 위상 / 프로필 비교 / 재고 차감 도트 / 다음 배치 라벨 |
| `#8080F0` | 중간 보라 — End 마커 / 재고 부족(Out) 배지 / UI 악센트 |
| `#A6B0FF` | 연한 페리윙클 — Drop 마커 / 대기(pending)/건너뜀(skipped) 배지 / 오프라인 상태 / 무료 플랜 배지 / Coming soon 배지 |
| `#E4E4E4` | 밝은 회색 — 보더/구분선 (light) |
| `#A3A2A2` | 중간 회색 — Light 로스트 레벨 텍스트 |
| `#6C6A6B` | 어두운 회색 — Medium-Light 로스트 레벨, 구분선 (dark) |

### Sensor & Chart Colors (light / dark)

| 토큰 | Light | Dark | 의미 |
|---|---|---|---|
| `--color-sensor-bt` | `#22a85a` | `#4be08c` | Bean Temperature (녹색) |
| `--color-sensor-bt-target` | `rgba(40,180,130,0.65)` | `rgba(75,224,140,0.65)` | BT 목표 곡선 |
| `--color-sensor-et` | `#4a85c5` | `#beacf8` | Environmental Temp (청색) |
| `--color-sensor-ror` | `#e8a828` | `#ffff54` | Rate of Rise (황색) |
| `--color-chart-grid` | `rgba(0,0,0,0.08)` / stroke `0.10` | `rgba(255,255,255,0.10)` / stroke `0.12` | 차트 그리드 |
| `--color-chart-axis-label` | `#666` | `#888` | 차트 축 레이블 |
| `--color-chart-phaseline` | `rgba(0,0,0,0.07)` | `rgba(255,255,255,0.08)` | 페이즈 경계선 |
| `--color-chart-tooltip-bg` | `#fff` | `#222` | 툴팁 배경 |
| `--color-scrollbar-thumb` | `rgba(0,0,0,0.1)` | `rgba(255,255,255,0.12)` | 스크롤바 |

### Phase Colors

| 페이즈 | Hex | 용도 |
|---|---|---|
| Ready | `#81FBA5` | 준비 완료 |
| Drying | `#FFFF54` | 건조 |
| Maillard | `#44BFFC` | 마이야르 |
| Development | `#756AFC` | 전개 |
| Danger | `#0B0B0B` | 위험 / 임계 |

### Shadows

다중 레이어 저불투명도 그림자 — 절대 10%를 넘지 않음. 따뜻한 톤의 `rgba(78,50,23,0.04)`를 사용해 부드러운 깊이감.

| 토큰 | Light 값 | 용도 |
|---|---|---|
| `--shadow-inset` | `rgba(0,0,0,0.075) 0px 0px 0px 0.5px inset` | 인풋 내부 그림자 |
| `--shadow-outline` | `rgba(0,0,0,0.06) 0px 0px 0px 1px` | 아웃라인 |
| `--shadow-elevation` | `rgba(0,0,0,0.04) 0px 4px 4px` | 얕은 입체 |
| `--shadow-card` | `rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px` | 카드 |
| `--shadow-warm` | `rgba(78,50,23,0.04) 0px 6px 16px` | 따뜻한 그림자 (드롭다운 등) |
| `--shadow-ring` | `rgba(0,0,0,0.06) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 1px 2px, rgba(0,0,0,0.04) 0px 2px 4px` | 셀렉트/팝오버 링 |
| `--shadow-edge` | `rgba(0,0,0,0.08) 0px 0px 0px 0.5px` | 엣지 라인 |

> **원칙:** 그림자는 항상 `opacity < 0.1`. 다중 레이어로 쌓아 자연스러운 깊이감을 만든다. Dark 모드에서는 대비를 높여 `opacity 0.2~0.4`.

### Typography

| 속성 | 값 |
|---|---|
| `--font-display` | `'Inter', 'Pretendard', system-ui, -apple-system, sans-serif` |
| `--font-body` | `'Inter', 'Pretendard', system-ui, -apple-system, sans-serif` |
| `--font-mono` | `monospace` |

- **영문 전용 페이지**에서는 Pretendard 제외: `html[lang='en']` → `--font-display: 'Inter', system-ui...`
- **`font-variant-numeric: tabular-nums lining-nums`** 가 `body`에 전역 적용. 재선언 금지.
- **`font-kerning: normal`**, `font-feature-settings: 'kern' 1, 'tnum' 1, 'lnum' 1, 'zero' 1`

#### Type Scale

| 요소 | Size | Weight | Tracking | 기타 |
|---|---|---|---|---|
| Page Title (h1) | `32px` | Semi-bold | `-0.4px` | `font-(--font-display)` |
| 섹션 타이틀 (h2) | `26px` | Light (`300wt`) | `-0.3px` | `font-display` |
| KPI Value | `26px` | Semi-bold | `-0.5px` | `leading-[1.2]` |
| 본문 | `14-16px` | Regular/Medium | `+0.14px` | |
| 작은 텍스트 | `13px` | Medium | `+0.14px` | 버튼, 테이블 셀 |
| 캡션/라벨 | `12px` | Medium | `+0.14px` | |
| 베이지/카드 라벨 | `13px` | — | `+0.14px` | `text-muted` |
| 머신/설정 라벨 | `12px` | Medium | — | `text-secondary`, `mb-1.5` |

### Spacing & Layout

| 토큰 | 값 |
|---|---|
| Base unit | `4px` (Tailwind spacing) |
| Page padding (X) | `40px` (`px-10`) |
| Page padding (Y) | `32px` (`py-8`) |
| Page max-width | `1280px` (가변, `PageLayout` 기본값) |
| Section 제목 아래 여백 | `28px` (`mb-7`) |
| 섹션 간격 | `24-32px` |
| 그리드 갭 | `24px` (`gap-6`) |

---

## Components

### Buttons

**Primary (Pill)**
```tsx
<PillButton>
// bg-primary text-white rounded-full
// px-4.5 py-2.5 text-sm font-medium
// tracking-[0.14px], cursor-pointer
// border-none, dark:border-white dark:bg-[#171717]
```

- Shape: **rounded-full (9999px pill)**
- Background: `--color-primary` (`#171717`)
- Text: white
- 좌측에 Lucide 아이콘을 `gap-2`로 배치 가능

**Secondary (Dashed Border)**
```
// rounded-lg border border-dashed border-[#E5E5E5]
// bg-transparent text-sm text-muted
// hover:text-secondary hover:border-black/15
// tracking-[0.14px]
```

- Shape: rounded-lg (8px), dashed border
- 사용처: "추가" 버튼 (bean, blend 등)

### Page Header

```
┌──────────────────────────────────────┐
│ Page Title (h1, 32px)       [Actions]│
│ Subtitle (text-sm, muted)            │
└──────────────────────────────────────┘
```

- `PageLayout` (px-10 py-8) 내부에서 사용
- 제목 + 액션 영역은 `flex items-end justify-between`
- 제목과 첫 콘텐츠 사이 `mb-7`

### Page Layout

```tsx
<PageLayout maxWidth={1280}>
  <PageHeader title="..." subtitle="..." actions={...} />
  {/* content */}
</PageLayout>
```

- 가운데 정렬 (`mx-auto`), `w-full` 고정
- 패딩: `px-10 py-8`

### Modal (ModalShell)

- **Overlay:** `fixed inset-0 bg-[rgba(23,23,23,0.32)] backdrop-blur-sm`
- **정렬:** `flex items-center justify-center p-6`
- **z-index:** `z-1000`
- Overlay 클릭 → 닫힘, 내부 클릭 → 이벤트 전파 차단

### KPI Card

```
┌──────────────────────────┐
│ [icon]            [+12%] │ <- 배지
│                          │
│ 1,234                    │ <- KPI 값 (26px, semibold)
│ Total Batches            │ <- 라벨 (13px, muted)
└──────────────────────────┘
```

- `bg-main-bg rounded-lg`
- 내부 패딩: `px-5 pt-5 pb-4.5`
- 아이콘: 16px, `strokeWidth={1.5}`, `--color-secondary`, 34x34 surface 박스 (`rounded-lg`)

### Input / CounterInput

```
// 라벨: block text-[12px] font-medium text-secondary mb-1.5
// 인풋: rounded-xl border border-[rgba(0,0,0,0.08)]
//       bg-surface px-3.5 py-2.5 text-[13px]
//       shadow-(--shadow-inset)
//       focus:border-[rgba(0,0,0,0.2)]
```

- Label은 상단에 위치, `htmlFor`로 input과 연결
- 숫자 입력 전용: 좌우 Chevron 버튼으로 증감 가능

### Select (Radix UI)

```
trigger: min-w-[6rem] / text-[13px] / tracking-[0.14px]
content: z-50 / max-h-56 / min-w-[6rem] / rounded-lg / shadow-ring
item:    px-2 py-1.5 / text-[13px] / tracking-[0.14px] / text-secondary
label:   px-2 py-1 / text-[11px] / font-medium / uppercase / tracking-[0.5px] / text-muted
```

### Calendar (react-day-picker)

- Day cell: `w-9 h-9 rounded-lg text-[13px] font-medium`
- Navigation: `w-6 h-6 rounded-md bg-surface shadow-inset`
- Weekday header: `text-[11px] font-medium text-muted`

---

## Page Patterns

### 페이지별 구조

**Dashboard (대시보드)**
- KPI 카드 4열 그리드 (Total Batches, Avg Score, Monthly Volume, Active Machines)
- 최근 로스팅 목록
- 월별 배치 차트

**History (히스토리)**
- 필터 바 (날짜, 원두, 정렬)
- 검색 + CSV 내보내기
- 페이지네이션된 테이블 (컬럼: Date, Bean, Duration, Drop Temp, Level)
- 월간 보고서 모달

**Active Roast (로스팅 중)**
- 좌측: 실시간 센서读数 + 차트 (uPlot)
- 우측: 이벤트 버튼 + 로그
- 하단: 머신 컨트롤

**Bean (생두 관리)**
- 좌측 블렌드 목록 + 우측 디테일 패널
- 블렌드/생두 추가 모달

### 공통 패턴

1. **PageLayout** 으로 페이지 감싸기
2. **PageHeader** 로 제목 + 액션 배치
3. 카드는 `bg-main-bg rounded-lg`
4. 버튼은 **pill** (`rounded-full`), 보조 버튼은 **dashed border**
5. 모든 아이콘은 **Lucide** (`lucide-react`), `strokeWidth={1.5}` 기본
6. 로딩 중에는 **Spinner** 컴포넌트 사용
7. **tracking-[0.14px]** 가 body 텍스트의 기본

---

## Dark Mode

`html.dark` 클래스 기반. CSS 변수로 전환.

| Light 변수 | Dark 변수 |
|---|---|
| `--color-main-bg: #fff` | `--color-main-bg: #1a1a1a` |
| `--color-surface: #efeff0` | `--color-surface: #222` |
| `--color-primary: #171717` | `--color-primary: #e5e5e5` |
| `--color-sensor-bt: #22a85a` | `--color-sensor-bt: #4be08c` |
| `--color-sensor-et: #4a85c5` | `--color-sensor-et: #beacf8` |
| `--color-sensor-ror: #e8a828` | `--color-sensor-ror: #ffff54` |

> 센서 색상은 Dark 모드에서 더 밝고 선명하게 전환 — 어두운 배경에서 가독성 확보.

---

## CSS Architecture

- **Tailwind CSS v4** (`@tailwindcss/vite`)
- **shadcn/ui** 스타일 레이어 — `cn()` 유틸리티로 클래스 병합
- 모든 스타일은 Tailwind utility class 사용. **인라인 `style` prop 금지** (예외: 동적 계산값)
- `@theme` 블록에 커스텀 토큰 정의
- `@custom-variant dark`로 다크 모드 지원
- `font-variant-numeric` — 전역 설정, 컴포넌트에서 재선언 금지

### Tailwind v4 주의사항

- `@import 'tailwindcss'` — v4 진입점
- `@theme` 블록 내에서 `--color-*` 변수 선언
- `shadow-(--shadow-inset)` 문법으로 커스텀 그림자 참조
- `font-(--font-display)` 문법으로 커스텀 폰트 참조

---

## Asset References

| 리소스 | 위치 |
|---|---|
| Pretendard 폰트 | `public/fonts/PretendardVariable.woff2` |
| Inter 폰트 | Google Fonts (`https://fonts.googleapis.com/css2?family=Inter:wght@100..900`) |
| 아이콘 | `lucide-react` 패키지 |

---

## 코드 구조 참고

- **CSS 변수:** `src/App.css` (`@theme` + `:root` + `html.dark`)
- **UI 프리미티브:** `src/shared/ui/`
- **센서/차트 색상:** `src/features/active-roast/lib/colors.ts`
- **페이지 레이아웃:** `src/shared/ui/PageLayout.tsx`, `src/shared/ui/PageHeader.tsx`
- **버튼:** `src/shared/ui/PillButton.tsx`
- **모달:** `src/shared/ui/modal-shell/ModalShell.tsx`
- **KPI 카드:** `src/shared/ui/KpiCard.tsx`
- **달력:** `src/shared/ui/calendar/Calendar.tsx`
- **셀렉트:** `src/shared/ui/select/Select.tsx`
