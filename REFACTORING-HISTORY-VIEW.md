# `src/views/history` 리팩토링 리포트

## 개요

클린 아키텍처 + FSD(Feature-Sliced Design) + SRP 원칙에 따라 `src/views/history/` 디렉토리와 그 의존성을 진단하고 리팩토링한 결과.

### 진단 요약

| 위반 사항 | 심각도 | 위치 | 해결 |
|---|---|---|---|
| 한 파일 10+ 책임 (SRP 대파괴) | 🔴 Critical | `History.tsx` 1035줄 | 7개 파일로 분할 |
| 필터 로직 3중 복제 | 🔴 Critical | `History.tsx` 3개 `useMemo`/함수 | `shared/lib/sessionFilter.ts`로 통일 |
| `formatDuration` 중복 정의 | 🟡 Medium | `History.tsx` + `csv-export.ts` | `shared/lib/format.ts`로 통일 |
| `handleExportCsv` 3책임 | 🔴 Critical | `History.tsx` 898-955 | 필터링 = `filterSessions()` 위임 |
| ExpandedRow 인라인 + 데이터페칭 | 🟡 High | `History.tsx` | `widgets/history-table/`로 이동 |
| reportData 인라인 계산 | 🟡 Medium | `History.tsx` 824-866 | `shared/lib/buildReportData.ts`로 추출 |
| FilterDropdown/DateRangeFilter가 views 레이어에 종속 | 🟡 High | `History.tsx` | `shared/ui/`, `widgets/date-range-filter/`로 이동 |
| useHistoryChart가 views/hooks에 존재 (FSD 위반) | 🟡 High | `views/history/hooks/` | `entities/roast/chart-queries.ts`로 이동 |
| `history/hooks/` 디렉토리 사장 | 🟢 Low | `views/history/hooks/` | 삭제 |

### 변경 전 vs 변경 후

| 파일 | 변경 전 (라인) | 변경 후 (라인) | 증감 |
|---|---|---|---|
| `src/views/history/History.tsx` | 1,035 | 325 | **-710 (-68%)** |
| `src/features/export-csv/lib/csv-export.ts` | 95 | 90 | -5 |
| `src/entities/roast/index.ts` | 10 | 11 | +1 |
| **신규 파일** | | | |
| `src/shared/lib/format.ts` | — | 32 | +32 |
| `src/shared/lib/sessionFilter.ts` | — | 65 | +65 |
| `src/shared/lib/buildReportData.ts` | — | 69 | +69 |
| `src/shared/ui/FilterDropdown.tsx` | — | 68 | +68 |
| `src/widgets/history-table/ui/HistoryTable.tsx` | — | 363 | +363 |
| `src/widgets/history-table/index.ts` | — | 2 | +2 |
| `src/widgets/date-range-filter/ui/DateRangeFilter.tsx` | — | 222 | +222 |
| `src/widgets/date-range-filter/index.ts` | — | 2 | +2 |
| `src/entities/roast/chart-queries.ts` | — | 25 | +25 |
| **총계** | 1,140 | 1,274 | **+134** |

> 총 라인은 증가했으나, 이는 중복 로직이 제거되지 않은 상태에서 단일 파일이던 것을 책임별로 분할했기 때문. 중복 제거까지 고려한 순수 신규 로직은 더 적음.

## 변경 파일 목록

### 신규 생성 (7개)

| 파일 | 설명 |
|---|---|
| `src/shared/lib/format.ts` | `formatDuration`, `formatDateShort` 등 포매팅 유틸 — 기존 `src/shared/lib/format.ts`에 `formatDateShort` 추가 |
| `src/shared/lib/sessionFilter.ts` | `filterSessions()` (전체 조건), `filterBySearchAndOrigin()` (검색+원산지) 순수 필터 함수 |
| `src/shared/lib/buildReportData.ts` | `buildReportData()` — 월간 생산 리포트 데이터 빌더 |
| `src/shared/ui/FilterDropdown.tsx` | 재사용 가능한 필터 드롭다운 (outside-click close) |
| `src/widgets/history-table/ui/HistoryTable.tsx` | `columns`, `SortIcon`, `ExpandedRow`, `HistoryTable` + 페이지네이션 |
| `src/widgets/history-table/index.ts` | 위젯 public API |
| `src/widgets/date-range-filter/ui/DateRangeFilter.tsx` | `DatePreset`, `getPresetYMRange`, `DATE_PRESETS`, `DateRangeFilter` |
| `src/widgets/date-range-filter/index.ts` | 위젯 public API |
| `src/entities/roast/chart-queries.ts` | `useHistoryChart` — `views/history/hooks/`에서 이동 |

### 수정 (3개)

| 파일 | 변경 내용 |
|---|---|
| `src/views/history/History.tsx` | 1035→325줄. 인라인 컴포넌트/로직 제거, 위젯/shared 임포트로 대체 |
| `src/features/export-csv/lib/csv-export.ts` | `formatDuration` 자체 정의 → `@shared/lib/format` 임포트 |
| `src/entities/roast/index.ts` | `useHistoryChart` export 추가 |

### 삭제 (1개)

| 경로 | 사유 |
|---|---|
| `src/views/history/hooks/useHistoryChart.ts` | `entities/roast/chart-queries.ts`로 이동 |
| `src/views/history/hooks/` (빈 디렉토리) | 사용처 없음 |

## 아키텍처 다이어그램 (FSD)

```
views/history/History.tsx (325줄 — 오케스트레이션 only)
  ├── widgets/date-range-filter/ (날짜 범위 선택기)
  ├── widgets/history-table/ (테이블 + ExpandedRow + 페이지네이션)
  │     └── entities/roast/chart-queries (useHistoryChart - TSV 로드/파싱)
  ├── features/export-csv/ (CSV 내보내기)
  ├── entities/roast/ (useRoastSessionsPaginated, useRoastSessions)
  ├── entities/profile/ (useProfile)
  ├── shared/store/auth/ (useAuthStore)
  ├── shared/lib/sessionFilter.ts (순수 필터 함수)
  ├── shared/lib/buildReportData.ts (순수 리포트 데이터 생성)
  ├── shared/lib/format.ts (순수 포매팅 유틸)
  └── shared/ui/FilterDropdown.tsx (재사용 드롭다운)
```

## 검증

```
$ npx tsc --noEmit
✅ 0 errors
```

- FSD 레이어 의존성 역방향 import 0건
- `views/history/hooks/` 참조하는 파일 0건

## 업데이트된 repomix-output.xml

```bash
rtk repomix --silent
```
