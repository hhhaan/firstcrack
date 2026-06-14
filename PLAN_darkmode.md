# Dark Mode Implementation

## Overview

Dark mode is implemented using CSS custom properties (variables) with Tailwind CSS v4's `@custom-variant dark` directive. The `html.dark` class toggles all theme values reactively.

## Architecture

### Layer 1: FOUC Prevention (`index.html`)
- Inline `<script>` in `<head>` reads `localStorage.getItem('fc_theme')` before React mounts
- If `'dark'` or (unset + OS dark preference), adds `html.dark` class immediately
- Prevents white flash before JS hydration

### Layer 2: CSS Variables (`src/App.css`)
- **`:root`** — Light theme defaults (sensor colors, chart grid, shadows, scrollbars, phase bar)
- **`html.dark`** — Dark theme overrides for all the same tokens
- **`@custom-variant dark (&:where(.dark, .dark *))`** — Enables `dark:` Tailwind prefix

### Layer 3: Zustand Store (`src/shared/store/theme.ts`)
- Exports `useThemeStore` with `theme: 'light' | 'dark' | 'system' | null`
- `null` means user hasn't chosen → shows onboarding modal
- `initTheme()`: reads localStorage → resolves theme → applies DOM class → sets up `matchMedia` listener for `'system'` mode
- `setTheme()`: saves to localStorage, applies to DOM, handles `matchMedia` lifecycle

### Layer 4: Onboarding Modal (`src/widgets/theme-select-modal/ui/ThemeSelectModal.tsx`)
- Shows when `theme === null` (first launch, no `fc_theme` in localStorage)
- User picks Light/Dark/System → calls `setTheme()` → modal closes

### Layer 5: Chart Colors (`src/features/active-roast/lib/colors.ts` + `chart-config.ts`)
- `SENSOR_COLORS` values changed from hex strings to `var(--color-sensor-*)` — works for inline styles
- `CHART_COLORS` changed similarly — works for non-ECharts use
- `getResolvedChartColors()` in `chart-config.ts` — reads CSS variables via `getComputedStyle()` at runtime for ECharts (canvas doesn't support `var()`)
- `RoastTempChart.tsx` uses `useThemeStore` to get `resolvedTheme` as `useMemo` dependency → `useMemo` re-evaluates with fresh resolved colors on theme change

## CSS Variable Naming Convention

| Prefix | Purpose | Example |
|--------|---------|---------|
| `--color-` | Surface/text colors | `--color-surface`, `--color-primary` |
| `--color-sensor-` | Chart sensor colors | `--color-sensor-bt`, `--color-sensor-et` |
| `--color-chart-` | Chart chrome colors | `--color-chart-grid`, `--color-chart-phaseline` |
| `--shadow-` | Box shadows | `--shadow-card`, `--shadow-warm` |
| `--color-scrollbar-` | Scrollbar colors | `--color-scrollbar-thumb` |

## How to Add Dark Mode to a New Component

1. **Use Tailwind dark: prefix** for existing CSS variables:
   ```tsx
   <div className="bg-white dark:bg-[#222] text-[#111827] dark:text-[#e5e5e5]" />
   ```

2. **Use CSS variables** for theme-aware values:
   ```tsx
   <div style={{ background: 'var(--color-surface)' }} />
   ```

3. **For hardcoded colors**, add `dark:` variants:
   ```tsx
   <div className="text-[#111827] dark:text-[#e5e5e5] bg-[#F9FAFB] dark:bg-[#2a2a2a]" />
   ```

4. **For ECharts**, use `getResolvedChartColors()` at render time and add `resolvedTheme` as a `useMemo` dependency:
   ```tsx
   const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
   const option = useMemo(() => {
       const colors = getResolvedChartColors();
       // use colors.xxx in ECharts options
   }, [resolvedTheme, /* other deps */]);
   ```

## Remaining Work

- `GeneralSettingsTab.tsx` — Add theme selection UI (Light/Dark/System radio cards)
- `DrumHeatFanChart.tsx` — Apply same `getResolvedChartColors()` pattern as `RoastTempChart.tsx`
- `WorkspaceSettingsTab.tsx` — Replace hardcoded `#111827`, `#6B7280`, `bg-white`, `#F3F4F6` with CSS variables or `dark:` variants
- `SettingsModal.tsx` — Replace `bg-white`, `border-gray-200`, `bg-[#F9FAFB]` with CSS variables
- `RoastHeader.tsx` — Replace `#6b7280` text colors with `text-muted`
- Various widget files (`RoastLog`, `EventButtons`, `EndRoastModal`, `RoastSummaryModal`, `LiveReadings`, `MachineControls`, `ChartLegend`) — Replace hardcoded colors with CSS variables
- Login page — Check for hardcoded backgrounds/text colors
- Sidebar — Check for hardcoded colors