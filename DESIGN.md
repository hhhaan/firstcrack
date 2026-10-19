# DESIGN.md: First Crack Desktop

**프로젝트:** 로스터리 관리를 위한 데스크탑 애플리케이션 (Tauri v2 + React)

**Token SSoT:** `src/App.css` (`@theme` + `:root` + `html.dark`). 이 문서의 값은 해당 파일과 동기화한다. UI 프리미티브는 `src/shared/ui/`.

---

## Design Philosophy

미니멀하고 차분한 엔터프라이즈 감성. 높은 가독성과 정확한 수치 표현이 핵심. 장시간 사용하는 도구이므로 눈의 피로를 최소화하고, 데이터에 집중할 수 있도록 장식은 배제한다.

- **분위기:** 조용하고 정확한, 장인적인
- **키워드:** 미니멀, 저대비, 따뜻한 중성톤, 정밀함
- **No emoji** — 모든 아이콘은 Lucide (`lucide-react`) 사용
- **Affordance** — 조작 가능함은 아이콘을 더하지 않고 시그니파이어로 보여 준다. 밑줄, 커서, 테두리처럼 이미 있는 형태가 단서가 된다. 호버에만 숨기지 않는다.
- **No gradients** — 단색 + 미세한 그림자 레이어로 깊이감 표현
- **tw utility > style prop** — 예외는 동적 계산값만
- **테마 색 hex 하드코딩 금지** — `text-primary`, `bg-surface`, `border-border` 등 시맨틱 클래스 우선

---

## Token layers (App.css)

| Layer | Role |
|---|---|
| `@theme` | Tailwind v4 토큰 등록 + light 기본 UI 색/그림자/폰트. 팔레트는 여기서 hex 베이스라인 선언 |
| `:root` | Light 런타임 오버라이드: 센서·페이즈·이벤트·컨트롤·차트 + 크로매틱 팔레트 → **oklch** |
| `html.dark` | Dark 런타임 오버라이드: UI 표면/텍스트/그림자 + 센서·페이즈·이벤트·컨트롤·차트 + 크로매틱 팔레트 → hex |

**Effective value 규칙:** 런타임 light = `@theme` 후 `:root` 덮어쓰기. 런타임 dark = 상속 후 `html.dark` 덮어쓰기. 아래 표는 **effective Light / Dark** (컴포넌트가 실제로 쓰는 값).

크로매틱 팔레트 `@theme` 베이스라인 (light 런타임 전에 hex; 참고용):

| Token | `@theme` hex |
|---|---|
| `--color-palette-yellow` | `#ffff54` |
| `--color-palette-green` | `#81fba5` |
| `--color-palette-teal` | `#72ebbc` |
| `--color-palette-blue` | `#44bffc` |
| `--color-palette-indigo` | `#5c41ff` |
| `--color-palette-purple` | `#756afc` |
| `--color-palette-violet` | `#8080f0` |
| `--color-palette-lavender` | `#a6b0ff` |

---

## Design Tokens

### Surfaces & text

| Token | Light | Dark | 용도 |
|---|---|---|---|
| `--color-main-bg` | `#ffffff` | `#181d21` | 페이지/카드 배경 |
| `--color-roast-bg` | `#ffffff` | `#181d21` | 로스팅 화면 전용 배경 |
| `--color-surface` | `#efeff0` | `#181d21` | 버튼/인풋/서피스 배경 |
| `--color-surface-elevated` | `#efeff0` | `#262b30` | 카드·모달 내 상승 서피스 |
| `--color-surface-warm` | `rgba(245, 242, 239, 0.8)` | `rgba(30, 28, 26, 0.8)` | 따뜻한 톤 서피스 (호버 등) |
| `--color-surface-warm-solid` | `#f5f2ef` | `#272b30` | 따뜻한 톤 서피스 (불투명) |
| `--color-primary` | `#171717` | `#e5e5e5` | 주요 텍스트 |
| `--color-secondary` | `#4e4e4e` | `#a3a3a3` | 보조 텍스트 |
| `--color-muted` | `#777169` | `#8a8580` | 덜 중요한 텍스트, 플레이스홀더 |
| `--color-border` | `#e5e5e5` | `#585d61` | 테두리 |
| `--color-border-subtle` | `rgba(0, 0, 0, 0.05)` | `rgba(255, 255, 255, 0.08)` | 매우 미세한 테두리 |
| `--color-divider` | `#efeff0` | `#585d61` | 구분선 |

### Palette (`--color-palette-*`)

| Token | Light (effective) | Dark | 용도 예시 |
|---|---|---|---|
| `--color-palette-black` | `#0b0b0b` | `#0b0b0b` | 강한 대비, 다크 악센트 |
| `--color-palette-yellow` | `oklch(0.78 0.18 88)` | `#ffff54` | RoR / Drying / Heat |
| `--color-palette-green` | `oklch(0.6 0.18 155)` | `#81fba5` | Ready / TP / 연결 상태 |
| `--color-palette-teal` | `oklch(0.62 0.16 165)` | `#72ebbc` | Note / Drum |
| `--color-palette-blue` | `oklch(0.6 0.17 225)` | `#44bffc` | FC Start / Maillard / Fan |
| `--color-palette-indigo` | `oklch(0.58 0.18 280)` | `#5c41ff` | 강한 보라 악센트 |
| `--color-palette-purple` | `oklch(0.58 0.18 280)` | `#756afc` | 보라 악센트 |
| `--color-palette-violet` | `oklch(0.58 0.15 275)` | `#8080f0` | End / UI 악센트 |
| `--color-palette-lavender` | `oklch(0.64 0.14 275)` | `#a6b0ff` | Drop / pending / skipped |
| `--color-palette-gray-light` | `#e4e4e4` | `#e4e4e4` | 밝은 회색 보더 |
| `--color-palette-gray` | `#a3a2a2` | `#a3a2a2` | 중간 회색 |
| `--color-palette-gray-dark` | `#6c6a6b` | `#6c6a6b` | 어두운 회색 |

Tailwind: `bg-palette-blue`, `text-palette-green`, `bg-palette-lavender/15` 등.

### Compare colors

비교 화면의 배치 색은 선택 목록·범례·곡선·수치표에서 동일하게 사용한다. 센서와 페이즈 색을 배치 구분에 재사용하지 않는다.

| Token | Light | Dark |
|---|---|---|
| `--color-compare-blue` | `oklch(0.54 0.14 250)` | `oklch(0.78 0.1 250)` |
| `--color-compare-orange` | `oklch(0.58 0.15 50)` | `oklch(0.78 0.13 50)` |
| `--color-compare-purple` | `oklch(0.53 0.17 300)` | `oklch(0.78 0.13 300)` |
| `--color-compare-teal` | `oklch(0.52 0.09 175)` | `oklch(0.78 0.11 175)` |

### Sensor colors

| Token | Light | Dark | 의미 |
|---|---|---|---|
| `--color-sensor-bt` | `oklch(0.6 0.18 155)` | `#4be08c` | Bean Temperature |
| `--color-sensor-bt-target` | `oklch(0.6 0.18 155 / 0.55)` | `rgba(75, 224, 140, 0.65)` | BT 참조 곡선 (같은 색, 낮은 알파, 점선) |
| `--color-sensor-et` | `oklch(0.6 0.17 225)` | `#beacf8` | Environmental Temp |
| `--color-sensor-et-target` | `oklch(0.6 0.17 225 / 0.55)` | `rgba(190, 172, 248, 0.65)` | ET 참조 곡선 |
| `--color-sensor-ror` | `oklch(0.78 0.18 88)` | `#ffff54` | Rate of Rise |
| `--color-sensor-ror-target` | `oklch(0.78 0.18 88 / 0.55)` | `rgba(255, 255, 84, 0.65)` | RoR 참조 곡선 |

### Phase colors

| Token | Light | Dark | 의미 |
|---|---|---|---|
| `--color-phase-ready` | `oklch(0.6 0.18 155)` | `#81fba5` | Ready |
| `--color-phase-ready-bg` | `oklch(0.6 0.18 155 / 0.16)` | `rgba(129, 251, 165, 0.15)` | Ready 배경 |
| `--color-phase-drying` | `oklch(0.78 0.18 88)` | `#ffff54` | Drying |
| `--color-phase-drying-fill` | `oklch(0.78 0.18 88 / 0.26)` | `rgba(255, 255, 84, 0.18)` | Drying fill |
| `--color-phase-maillard` | `oklch(0.6 0.17 225)` | `#44bffc` | Maillard |
| `--color-phase-maillard-fill` | `oklch(0.6 0.17 225 / 0.26)` | `rgba(68, 191, 252, 0.18)` | Maillard fill |
| `--color-phase-development` | `oklch(0.6 0.18 155)` | `#81fba5` | Development |
| `--color-phase-development-fill` | `oklch(0.6 0.18 155 / 0.26)` | `rgba(129, 251, 165, 0.18)` | Development fill |
| `--color-fc-band-fill` | `oklch(0.6 0.18 155 / 0.1)` | `rgba(129, 251, 165, 0.08)` | FC band fill |
| `--color-bbp-fill` | `oklch(0.55 0 0 / 0.07)` | `oklch(1 0 0 / 0.07)` | BBP 구간 배경 (격자 유지) |
| `--color-phase-danger` | `#dc2626` | `#ffffff` | Danger / 임계 (light red, dark white) |
| `--color-phase-danger-bg` | `rgba(220, 38, 38, 0.1)` | `rgba(255, 255, 255, 0.12)` | Danger 배경 |

> `--color-phase-danger` light는 `#dc2626` (palette black 아님). Dark는 `#ffffff`.

### Event marker colors

| Token | Light | Dark |
|---|---|---|
| `--color-event-mark` | `oklch(0.55 0 0)` | `oklch(0.72 0 0)` | Charge·Yellow·FC·Drop·End·TP·Note |
| `--color-event-control` | `oklch(0.55 0.2 25)` | `oklch(0.72 0.17 25)` | committed 제어 조작 (Heater) |

### Control chart colors

| Token | Light | Dark |
|---|---|---|
| `--color-control-drum` | `oklch(0.62 0.16 165)` | `#72ebbc` |
| `--color-control-drum-target` | `oklch(0.62 0.16 165 / 0.55)` | `rgba(114, 235, 188, 0.65)` |
| `--color-control-heat` | `oklch(0.78 0.18 88)` | `#ffff54` |
| `--color-control-heat-target` | `oklch(0.78 0.18 88 / 0.55)` | `rgba(255, 255, 84, 0.65)` |
| `--color-control-heat-area` | `oklch(0.78 0.18 88 / 0.22)` | `rgba(255, 255, 84, 0.15)` |
| `--color-control-fan` | `oklch(0.6 0.17 225)` | `#44bffc` |
| `--color-control-fan-target` | `oklch(0.6 0.17 225 / 0.55)` | `rgba(68, 191, 252, 0.65)` |
| `--color-control-fan-area` | `oklch(0.6 0.17 225 / 0.22)` | `rgba(68, 191, 252, 0.15)` |

### Chart chrome

| Token | Light | Dark |
|---|---|---|
| `--color-chart-grid` | `rgba(0, 0, 0, 0.08)` | `rgba(255, 255, 255, 0.1)` |
| `--color-chart-grid-stroke` | `rgba(0, 0, 0, 0.1)` | `rgba(255, 255, 255, 0.12)` |
| `--color-chart-axis-label` | `#666` | `#888` |
| `--color-chart-current-line` | `rgba(0, 0, 0, 0.45)` | `rgba(255, 255, 255, 0.45)` |
| `--color-chart-phaseline` | `rgba(0, 0, 0, 0.07)` | `rgba(255, 255, 255, 0.08)` |
| `--color-chart-phasebar-stroke` | `rgba(0, 0, 0, 0.08)` | `rgba(255, 255, 255, 0.12)` |
| `--color-chart-phasebar-name` | `#444` | `#bbb` |
| `--color-chart-phasebar-duration` | `#555` | `#999` |
| `--color-chart-tooltip-bg` | `#fff` | `#181d21` |
| `--color-chart-tooltip-border` | `rgba(0, 0, 0, 0.08)` | `rgba(255, 255, 255, 0.1)` |
| `--color-chart-axis-pointer` | `#64748b` | `#64748b` |
| `--color-chart-tooltip-time` | `#9ca3af` | `#9ca3af` |
| `--color-chart-marker-label` | `#0b0b0b` | `#ffffff` |
| `--color-scrollbar-thumb` | `rgba(0, 0, 0, 0.1)` | `rgba(255, 255, 255, 0.12)` |
| `--color-scrollbar-thumb-hover` | `rgba(0, 0, 0, 0.16)` | `rgba(255, 255, 255, 0.2)` |

차트/센서 소비: `src/features/active-roast/lib/colors.ts` — `var(--color-…)` 로 참조.

#### Chart visual grammar

- History의 `report` 모드: 축 테두리·세로/보조 격자는 생략하고 수평 점선 격자만 표시한다. 온도 범위는 표시 중인 실측·참조 곡선에 맞추되 최소 40°C 폭을 유지한다. 온도 눈금은 범위에 따라 10·20·50°, RoR은 5°C/min 또는 10°F/min 간격이다. 짧은 기록의 시간 눈금은 5·15초 간격이다. 이벤트 가이드는 0.6px로 낮추며 센서 범례와 단계별 시간·비율을 카드 안에서 별도로 표시한다.

- 선 두께(px): 라이브 BT `1.2`, ET/RoR/ET RoR `0.9`, 제어 실측·Heat set `1.0`, Heat target `1.5` dotted, 참조 곡선 `0.8` dashed, 마킹 세로선 `0.6`, 제어 이벤트 세로선 `1.0`.
- 참조 곡선(BT·ET·RoR·Drum·Heater·Fan)은 라이브와 같은 채널 색의 `*-target` 토큰이다. 라이브보다 뒤에 그린다. 프로파일에 없는 채널과 저장되지 않은 ET RoR는 만들지 않는다. 결측 샘플은 null이며 0으로 채우거나 끊긴 구간을 잇지 않는다.
- Heat target(프로파일 화력 지시)과 Heat set(라이브 지시)은 참조 Heater와 다른 시리즈다. 지시값을 참조 곡선으로 복제하지 않는다. 순서: 참조 제어 → Heat target → Heat set → 실측 Heat.
- 이벤트 라벨: `이름|mm:ss|온도`. `600 10px monospace`. 앵커 오른쪽 `4px`에서 왼쪽 정렬. 동일 시각은 소스 순서로 `14px`씩 위로 쌓는다. 축 눈금·페이즈 바 글씨는 이 크기를 따르지 않는다.
- `eventMarkerStyle`: `point`(포인트+곡선 라벨), `line`(세로선+가장자리 라벨), `both`(곡선 라벨+제어 차트까지 관통하는 세로선). 기본은 `both`.

### Shadows

| Token | Light | Dark |
|---|---|---|
| `--shadow-inset` | `rgba(0, 0, 0, 0.075) 0px 0px 0px 0.5px inset` | `rgba(0, 0, 0, 0.4) 0px 0px 0px 0.5px inset` |
| `--shadow-outline` | `rgba(0, 0, 0, 0.06) 0px 0px 0px 1px` | `rgba(0, 0, 0, 0.3) 0px 0px 0px 1px` |
| `--shadow-elevation` | `rgba(0, 0, 0, 0.04) 0px 4px 4px` | `rgba(0, 0, 0, 0.3) 0px 4px 4px` |
| `--shadow-card` | `rgba(0, 0, 0, 0.4) 0px 0px 1px, rgba(0, 0, 0, 0.04) 0px 4px 4px` | `rgba(0, 0, 0, 0.6) 0px 0px 1px, rgba(0, 0, 0, 0.2) 0px 4px 4px` |
| `--shadow-warm` | `rgba(78, 50, 23, 0.04) 0px 6px 16px` | `rgba(0, 0, 0, 0.3) 0px 6px 16px` |
| `--shadow-ring` | `rgba(0, 0, 0, 0.06) 0px 0px 0px 1px, rgba(0, 0, 0, 0.04) 0px 1px 2px, rgba(0, 0, 0, 0.04) 0px 2px 4px` | `rgba(0, 0, 0, 0.3) 0px 0px 0px 1px, rgba(0, 0, 0, 0.2) 0px 1px 2px, rgba(0, 0, 0, 0.2) 0px 2px 4px` |
| `--shadow-edge` | `rgba(0, 0, 0, 0.08) 0px 0px 0px 0.5px` | `rgba(0, 0, 0, 0.4) 0px 0px 0px 0.5px` |

Tailwind 참조: `shadow-(--shadow-inset)`, `shadow-(--shadow-ring)`.

Light: 다중 레이어 저불투명도. Dark: 대비를 위해 opacity 0.2–0.4.

### Typography

| Token | Value |
|---|---|
| `--font-display` | `"Inter", "SUIT", system-ui, -apple-system, BlinkMacSystemFont, sans-serif` |
| `--font-body` | `"Inter", "SUIT", system-ui, -apple-system, BlinkMacSystemFont, sans-serif` |
| `--font-mono` | `monospace` |
| `--font-inconsolata` | `"Inconsolata", monospace` |

- **영문:** `html[lang='en']` → SUIT 제외: `"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif`
- **`font-variant-numeric: tabular-nums lining-nums`** — `body` + 전역 `*`. **컴포넌트에서 재선언 금지.**
- `font-kerning: normal`; `font-feature-settings: "kern" 1, "tnum" 1, "lnum" 1, "zero" 1`
- 로스팅 우측 패널 숫자: Inconsolata, `letter-spacing: -0.03em`.
- body: `16px` / `line-height: 1.5` / `color: var(--color-primary)` / `background: var(--color-surface)`

#### Type scale (구현 관례)

| 요소 | Size | Weight | Tracking | 기타 |
|---|---|---|---|---|
| Page Title (h1) | `32px` | — | `-0.4px` | `font-(--font-display)`, `leading-[1.13]` |
| 섹션 타이틀 | `26px` | Light (`300`) | `-0.3px` | |
| KPI Value | `26px` | Semi-bold | `-0.5px` | `leading-[1.2]` |
| 본문 | `14–16px` | Regular/Medium | `+0.14px` | |
| 작은 텍스트 | `13px` | Medium | `+0.14px` | 버튼, 테이블 셀 |
| 캡션/라벨 | `12px` / `11px` | Medium/Semi | `+0.14px` / uppercase | form labels |

### Spacing & Layout

| 토큰 | 값 |
|---|---|
| Base unit | `4px` (Tailwind spacing) |
| Page padding (X) | `40px` (`px-10`) |
| Page padding (Y) | `32px` (`py-8`) |
| Page max-width | `1280px` (`PageLayout` 기본) |
| 제목 아래 여백 | `28px` (`mb-7`, PageHeader) |
| 섹션 간격 | `24–32px` |
| 그리드 갭 | `24px` (`gap-6`) |

---

## Components / primitives

패턴 소스는 `src/shared/ui/`. 아래는 outcome-level 규칙 — 구현 시 해당 파일 우선.

### PageLayout / PageHeader

```tsx
<PageLayout maxWidth={1280}>
  <PageHeader title="..." subtitle="..." actions={...} />
  {/* content */}
</PageLayout>
```

- **PageLayout:** `px-10 py-8 w-full mx-auto`, maxWidth 기본 `1280` (inline style — 동적 값 예외)
- **PageHeader:** `flex items-end justify-between mb-7`
  - h1: `font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px]`
  - subtitle: `text-sm text-muted tracking-[0.14px]`
  - actions: `flex shrink-0 items-center gap-2`

### PillButton (primary CTA)

- Shape: `rounded-full`, `px-4.5 py-2.5`, `text-sm font-medium tracking-[0.14px]`
- Light: `bg-primary text-white border-none`
- Dark: `dark:bg-[#0d0d0d] dark:border-white` (컴포넌트 고정 예외)
- Optional leading icon, `gap-2`
- Hover: `hover:-translate-y-px`

### SurfaceButton (secondary soft CTA)

- `rounded-lg bg-surface dark:bg-surface-elevated`, `text-[13px] font-medium text-primary`
- 스케줄 “배치 추가”, empty-state 등 — primary 검정 알약이 아닌 경우

### ModalShell

- Overlay: `fixed inset-0 bg-[rgba(23,23,23,0.32)] backdrop-blur-sm flex items-center justify-center p-6 z-1000`
- Overlay click → close (`dismissable`, default true); content `stopPropagation`
- `role="dialog"` + `aria-labelledby` + `aria-modal`
- Panel chrome: `modalPanel` sizes in `src/shared/ui/modal-shell/modalPanel.ts` (`sm` ~420px confirm, `formSm`/`formMd`/`formLg`, `compare`, `settings`)
- Prefer `bg-main-bg` / `border-border` 시맨틱 토큰. 폼 모달은 `form-styles.ts`의 `modalHeaderChrome` / `modalFooterChrome` / `modalPrimaryBtnCls` / `modalCancelBtnCls`

### Badge

- `src/shared/ui/Badge.tsx` — read-only status pill (`rounded-full`)
- Tones: `neutral`, `soft`, `good`, `bad`, `warn`, `amber`, `lavender`, `lavenderSoft`, `blue`, `green`, `yellow`, `muted`
- 시맨틱: `text-palette-*` / `bg-palette-*/12|15` 우선; 동적 색만 `color`/`bg` style 예외

### Icons (Lucide)

모든 아이콘 `lucide-react`, 기본 `strokeWidth={1.5}`. 색은 `currentColor` — 부모에 시맨틱 `text-*`.

| Variant | 박스 | 아이콘 색 | 용도 |
|---|---|---|---|
| **default** | `w-8.5 h-8.5 rounded-lg bg-surface dark:bg-surface-elevated` | `text-secondary` | KPI, 리스트 |
| **compact** | `w-8 h-8 rounded-lg bg-main-bg` | `text-muted` | 모달 옵션 행 |
| **accent** | `w-10 h-10 rounded-xl bg-palette-blue/12 dark:bg-surface-elevated` | `text-palette-blue dark:text-primary` | 모달 헤더 강조 |

### KPI Card

- 위치: `src/views/dashboard/components/KpiCard.tsx`
- `bg-main-bg rounded-lg dark:border dark:border-border`, padding `px-5 pt-5 pb-4.5`
- 아이콘 박스 default variant; 값 `text-[26px] font-semibold text-primary tracking-[-0.5px]`; 라벨 `text-[13px] text-muted`
- 변화 배지: `Badge` tone `good` / `bad`

### Form fields

- Shared: `src/shared/ui/form-styles.ts` — `inputCls`, `labelCls`, `selectCls`, `chipCls`, `tabCls`
- Label: small uppercase muted (`text-[11px] font-semibold text-muted`)
- Input: `rounded-xl`, inset shadow, surface/elevated backgrounds
- Select: Radix `src/shared/ui/select/Select.tsx` — `text-[13px] tracking-[0.14px]`, content `shadow-ring`
- Calendar: `src/shared/ui/calendar/Calendar.tsx` — day `w-9 h-9 rounded-lg text-[13px]`

---

## Page Patterns

1. **PageLayout**으로 페이지 감싸기
2. **PageHeader**로 제목 + 액션
3. 카드: `bg-main-bg rounded-lg` (+ dark border when needed)
4. Primary CTA: **PillButton**; soft secondary: **SurfaceButton**; dashed “추가” 패턴은 로컬 dashed border
5. 아이콘: **Lucide** only, `strokeWidth={1.5}`
6. 로딩: **Spinner** (`src/shared/ui/Spinner.tsx`)
7. Body tracking 관례: `tracking-[0.14px]`

**Dashboard** — KPI 그리드 + 최근 로스팅 + 월별 차트  
**History** — 필터/검색/CSV/테이블/페이지네이션  
**Active Roast** — 센서 차트(uPlot) + 이벤트 + 머신 컨트롤  
**Bean** — 마스터-디테일 (`MasterDetailLayout`)

---

## Dark Mode

`html.dark` 클래스. `@custom-variant dark (&:where(.dark, .dark *));`

- CSS 변수로 전환 — 컴포넌트에서 `dark:text-[#a3a3a3]`처럼 토큰 값을 hex로 중복하지 말 것
- 시맨틱 클래스 하나면 충분: `text-primary`, `bg-surface`, `border-border`, `bg-surface-elevated`
- 센서·팔레트·이벤트는 dark에서 더 밝고 선명한 hex로 전환 (어두운 배경 가독성)

---

## CSS Architecture

- **Tailwind CSS v4** (`@import "tailwindcss"`, `@tailwindcss/vite`)
- **shadcn-style** `cn()` 클래스 병합 (`@shared/lib/cn`)
- 스타일: Tailwind utility 우선. **인라인 `style` 금지** (예외: 동적 maxWidth, 동적 Badge 색 등)
- **테마 인식 색 hex 하드코딩 금지** — `text-palette-blue`, `border-border` 사용
- `@theme`에 커스텀 토큰 등록; `:root` / `html.dark`에서 light/dark 오버라이드
- `shadow-(--shadow-inset)`, `font-(--font-display)` 문법
- `font-variant-numeric` 전역 — 재선언 금지

---

## Asset References

| 리소스 | 위치 |
|---|---|
| Inter (Latin primary) | `public/fonts/InterVariable.woff2` |
| SUIT (한글 폴백) | `public/fonts/SUIT-Variable.woff2` |
| Inconsolata (로스팅 우측 패널 숫자) | `public/fonts/Inconsolata-Variable.woff2` |
| Icons | `lucide-react` |

---

## Code map

| What | Where |
|---|---|
| CSS variables (SSoT values) | `src/App.css` |
| This doc (agent design SSoT) | `DESIGN.md` |
| UI primitives | `src/shared/ui/` |
| Sensor/phase CSS var consumers | `src/features/active-roast/lib/colors.ts` |
| PageLayout / PageHeader | `src/shared/ui/PageLayout.tsx`, `PageHeader.tsx` |
| PillButton / SurfaceButton | `src/shared/ui/PillButton.tsx`, `SurfaceButton.tsx` |
| ModalShell / modalPanel | `src/shared/ui/modal-shell/` |
| Badge / form-styles | `src/shared/ui/Badge.tsx`, `form-styles.ts` |
| KPI card | `src/views/dashboard/components/KpiCard.tsx` |
| Calendar / Select | `src/shared/ui/calendar/`, `src/shared/ui/select/` |
