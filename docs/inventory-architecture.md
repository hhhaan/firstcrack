# Inventory Architecture — 진단 & 전환 보고서

> 최종 검증: 2026-06-19
> 상태: 이벤트 소싱 기반 단일 시스템으로 전환 완료 (dead code 정리 남음)

---

## 1. 원래 문제 (What Was Broken)

### 1.1 두 개의 병렬 재고 시스템

프로젝트는 한동안 **재고를 두 개의 독립된 시스템으로 동시에 추적**하고 있었다.

| 시스템 | 테이블 | 역할 |
|---|---|---|
| **Legacy** | `beans.stock_grams` + `bean_inventory_logs` | 비정규화 컬럼 + 트랜잭션 저널 |
| **Modern** | `bean_stock_events` | 이벤트 소싱 기반 재고 추적 |

### 1.2 데이터 불일치 매트릭스 (예전 상태)

모든 액션마다 두 시스템이 **서로 다른 조합으로 기록되어** UI가 표시하는 값과 실제 재고가 불일치했다.

| 액션 | `beans.stock_grams` | `bean_inventory_logs` | `bean_stock_events` |
|---|---|---|---|
| 신규 Bean 등록 | `0` 으로 고정 | `purchase` 기록 | 기록 안 함 ✗ |
| Bean 정보 편집 | 직접 덮어쓰기 | 기록 안 함 | 기록 안 함 |
| 재입고 (Restock) | 업데이트 안 함 | `purchase` 기록 | `purchase` 기록 |
| 단일원두 로스팅 | 업데이트 안 함 | `roast` 기록 | 기록 안 함 ✗ |
| 블렌드 로스팅 | 업데이트 안 함 | 기록 안 함 | `roast` 기록 |

### 1.3 UI가 서로 다른 소스를 참조

같은 화면에서도 컴포넌트마다 다른 재고값을 바라보고 있었다.

| UI | 참조 소스 | 문제 |
|---|---|---|
| BeanList 재고바/뱃지 | `beans.stock_grams` | 입출고 미반영 |
| BeanDetail 상단 정보 | `beans.stock_grams` | 입출고 미반영 |
| BeanDetail 재고 요약 패널 | `bean_stock_events` SUM | **정확했던 유일한 곳** |
| Dashboard 재고 알림 | `beans.stock_grams` | 입출고 미반영 + 예약 미고려 |
| AddBatchModal 재고 체크 | `stock_grams` + `effectiveGrams` 혼용 | 같은 모달에서 두 값이 달랐음 |
| `getStatus()` | `beans.stock_grams` | 입출고 미반영 |

### 1.4 DB 트리거/함수 부재

`beans.stock_grams`를 동기화해주는 PostgreSQL 트리거나 함수가 **하나도 존재하지 않았다**.
`supabase/migrations/` 전체에 `FUNCTION`/`TRIGGER`/`trigger`/`function` 검색 결과 0건.

입출고 이벤트가 발생해도 `beans.stock_grams`는 **절대 자동 갱신되지 않았다**.
즉 재입고해도, 로스팅해도 UI가 보여주는 숫자는 바뀌지 않았다.

---

## 2. 해소 완료 (What Was Fixed)

### 2.1 모든 입출고가 `bean_stock_events` 하나로 통일

| 액션 | 코드 위치 | 이벤트 |
|---|---|---|
| 신규 Bean 등록 (+입고) | `widgets/add-bean-modal/ui/useAddBeanSubmit.ts:68` | `delta_grams: +stockGrams, event_type: 'purchase'` |
| 재입고 (Restock) | `widgets/add-bean-modal/ui/useAddBeanSubmit.ts:94` | `delta_grams: +amount, event_type: 'purchase'` |
| 단일원두 로스팅 | `views/active-roast/ActiveRoast.tsx:1065` | `delta_grams: -deduction, event_type: 'roast'` |
| 블렌드 로스팅 | `views/active-roast/ActiveRoast.tsx:1084` | `delta_grams: -ratio, event_type: 'roast'` (컴포넌트별) |

### 2.2 모든 UI가 `effectiveGrams`를 읽도록 전환

| UI | 읽는 방식 | 위치 |
|---|---|---|
| BeanList | `stockSummaries[bean.id].effectiveGrams` (prop) | `widgets/bean-list/ui/BeanList.tsx:107` |
| BeanDetail | `useBeanStockSummary(bean.id) → effectiveGrams` | `widgets/bean-detail/ui/BeanDetail.tsx:50,56` |
| Dashboard | `getStockSummariesByUser(userId) → item.effectiveGrams` | `views/dashboard/useDashboard.ts:143` |
| AddBatchModal | `useBeanStockSummary(beanId) → effectiveStockKg` | `widgets/add-batch-modal/ui/AddBatchModal.tsx:178-179` |

### 2.3 `getStatus()` 시그니처 변경

```typescript
// entities/bean/lib.ts:5
// 이전: getStatus(bean: Bean) → bean.stock_grams 참조
// 현재: getStatus(effectiveGrams: number, lowStockThresholdGrams: number)

export const getStatus = (effectiveGrams: number, lowStockThresholdGrams: number): BeanStatus => {
    if (effectiveGrams <= 0) return 'Out';
    if (effectiveGrams <= lowStockThresholdGrams) return 'Low';
    return 'Good';
};
```

### 2.4 캐시 무효화 완비

- `useInsertStockEvent` → onSuccess 시 `['bean-stock-summaries']`, `['bean-stock-summary', beanId]`, `['bean-stock-events', beanId]` 모두 무효화 (`entities/bean-stock-event/queries.ts:36-40`)
- ActiveRoast 로스팅 완료 → 차감 후 `qc.invalidateQueries`로 캐시 수동 무효화 (`ActiveRoast.tsx:1105-1116`)

### 2.5 배치 조회 최적화 (`getStockSummariesByUser`)

`bean-stock-event/api.ts` — user의 모든 bean에 대한 재고 요약을 한 번의 배치 호출로 가져오는 함수.
BeanList와 Dashboard에서 N+1 쿼리를 방지한다.

### 2.6 블렌드 차감 silent fail 수정

`ActiveRoast.tsx` 블렌드 구성 생두 차감 코드에서 inner try/catch 제거.
`blendApi.get()` 실패 시 에러가 outer catch로 전파되어 유저에게 "저장 실패" 다이얼로그 표시.

### 2.7 예약재고 계산 정확성 수정 (`getReservedStock`, `getStockSummariesByUser`)

**문제였던 것**: `reservedGrams = SUM(batch_size_kg * batch_count * 1000)` — 다회차 배치(batch_count > 1)에서 중간 세션이 완료돼도 예약량이 줄지 않아 effectiveGrams가 실제보다 낮게 표시됐다.

```
예시: 3kg 배치(1kg×3회), 재고 10kg
1차 완료 후: current=9,000 / reserved=3,000 / effective=6,000  ← 실제는 7,000g
```

**수정된 계산**: `reservedGrams = SUM((batch_count - completed_sessions) * batch_size_kg * 1000)`

`completed_sessions`는 `roast_sessions.plan_batch_id` 카운트로 계산 (DB 컬럼 아님).

---

## 3. 잔존 문제 (Remaining Issues)

### 3.1 `bean_inventory_logs` — 완전한 dead code

디렉토리와 모든 코드 (`entities/bean-inventory/`)가 그대로 존재하지만,
`src/` 내 그 어떤 파일도 `from '@entities/bean-inventory'`를 import하지 않는다.

- `entities/bean-inventory/api.ts` — list/create/update/delete
- `entities/bean-inventory/queries.ts` — useBeanInventoryLogs, useCreateBeanInventoryLog, useUpdateBeanInventoryLog, useDeleteBeanInventoryLog
- `entities/bean-inventory/index.ts` — barrel export

**→ 제거 대상**

### 3.2 `beans.stock_grams` 컬럼 — dead column

- DB와 `database.types.ts` 타입에만 존재
- **쓰기**: `useAddBeanSubmit.ts:61` — Bean 생성 시 `stock_grams: 0` 하드코딩 (유일한 쓰기 위치)
- **읽기**: 모든 UI에서 `effectiveGrams`로 대체됨 (0건)
- Bean 편집 시에도 더 이상 `stock_grams`를 update payload에 포함하지 않음

**→ DB 마이그레이션으로 제거 대상**

### 3.3 Adjustment(조정) 기능 미구현

- DB CHECK 제약에 `event_type IN ('purchase', 'roast', 'adjustment')`로 정의되어 있으나 (`migrations/20260611065045_add_blends_and_stock_tables.sql:40`)
- adjustment를 생성하는 UI / API 호출 없음

**→ 신규 기능 구현 필요**

### 3.4 Write-off(폐기) 이벤트 타입 없음

- DB CHECK 제약에 `'write_off'` 미포함
- 실무에서 생두 폐기/손실을 기록할 방법 없음

**→ 마이그레이션 + UI 구현 필요**

### 3.5 원자성 없는 차감 (미해결)

블렌드 로스팅 완료 시 복수의 `beanStockEventApi.insert()`가 `Promise.all`로 실행됨.
일부 성공 후 일부 실패하면 재고가 부분 차감된 채로 남는다.
DB 레벨 트랜잭션 없이는 완전 해결 불가 — Supabase PostgreSQL 함수(RPC)로 단일 트랜잭션 처리 필요.

### 3.6 멱등성 없는 차감 (미해결)

로스팅 저장 실패 후 재시도 시 `beanStockEventApi.insert()`가 중복 실행될 수 있다.
`reference_id`(roast_session_id)는 기록되나 DB unique constraint 없음 → 이중 차감 가능.

**→ `bean_stock_events(reference_id)` unique constraint 추가 필요**

### 3.7 블렌드 ratio 반올림 오차

컴포넌트별 `Math.round(chargeGrams * ratio_pct / 100)` 독립 반올림.
합산이 `chargeGrams`와 불일치할 수 있어 이벤트마다 수g 오차 누적.

**→ 마지막 컴포넌트에서 잔량 처리하는 방식으로 수정 필요**

---

## 4. 현재 아키텍처 개요

```
                         ┌──────────────────────────────┐
                         │  DB: bean_stock_events        │
                         │  (single source of truth)     │
                         │  delta_grams ±                │
                         │  event_type: purchase|roast|  │
                         │              adjustment       │
                         └──────────────┬───────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
            getCurrentStock()   getReservedStock()   insert(event)
            SUM(delta_grams)    SUM(remaining *      단일 이벤트 기록
                                batch_size_kg * 1000)
                    │                   │
                    └─────────┬─────────┘
                              ▼
                      StockSummary {
                        currentGrams
                        reservedGrams      ← (batch_count - completed_sessions) * batch_size_kg * 1000
                        effectiveGrams     ← current - reserved
                      }
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
               BeanList   BeanDetail  Dashboard
               (prop)     (hook)      (batch fetch)
```

### 이벤트 타입

| `event_type` | delta | 설명 | 트리거 |
|---|---|---|---|
| `purchase` | `+` | 생두 입고 | Bean 생성, 재입고 |
| `roast` | `-` | 로스팅 소비 | ActiveRoast 완료 |
| `adjustment` | `±` | 수동 재고 조정 | (미구현) |
| `write_off` | `-` | 폐기/손실 | (미구현, DB 마이그레이션 필요) |

### 예약(Reservation) 로직

```
reservedGrams = SUM(
    (batch_count - completed_sessions) * batch_size_kg * 1000
)
WHERE status IN ('pending', 'scheduled')
  AND bean_id = target_bean

completed_sessions = COUNT(roast_sessions WHERE plan_batch_id = batch.id)
```

- 예약은 **읽기 전용 계산** (명시적 reserve API 없음)
- 배치가 `'done'`으로 전환되면 자동 해제 (`ActiveRoast.tsx:1101`)
- 중간 세션 완료 시에도 `completed_sessions` 증가로 예약량 즉시 감소 (2.7 수정)
- `effectiveGrams = currentGrams - reservedGrams` → 음수 가능 → 재고 부족 감지

---

## 5. 정리 로드맵

| 순서 | 작업 | 파일/대상 | 영향 |
|---|---|---|---|
| P0-1 | `bean_inventory_logs` 코드 제거 | `entities/bean-inventory/` 전체 + `database.types.ts` aliases | dead code 삭제 |
| P0-2 | `bean_inventory_logs` 테이블 제거 | DB 마이그레이션 | DB 클린업 |
| P1 | `beans.stock_grams` 컬럼 제거 | DB 마이그레이션 + 타입 재생성 | DB 스키마 정리 |
| P2 | `bean_stock_events(reference_id)` unique constraint | DB 마이그레이션 | 이중 차감 방지 |
| P3 | 블렌드 차감 원자성 | Supabase RPC (PostgreSQL 함수) | 부분 차감 방지 |
| P4 | Adjustment UI 구현 | 신규 feature/widget | 재고 조정 기능 |
| P5 | Write-off 이벤트 타입 추가 + UI | DB 마이그레이션 + feature | 폐기 기록 |

---

## 6. 관련 파일 인덱스

| Layer | File | Role |
|---|---|---|
| **entities** | `bean-stock-event/api.ts` | `bean_stock_events` CRUD + 현재/예약/요약 계산 |
| **entities** | `bean-stock-event/queries.ts` | React Query hooks + 캐시 무효화 |
| **entities** | `bean/lib.ts` | `getStatus()` (effectiveGrams 기반) + `statusConfig`, `processColor` |
| **entities** | `bean/api.ts` | `beans` 테이블 CRUD (stock_grams 제외) |
| **entities** | `bean/queries.ts` | `useBeans`/`useBean`/`useCreateBean`/`useUpdateBean`/`useDeleteBean` |
| **entities** | ~~`bean-inventory/*`~~ | **DEAD CODE** — import하는 곳 없음 |
| **features** | `active-roast/model/` | 로스팅 세션 상태 (차감 트리거) |
| **widgets** | `add-bean-modal/ui/useAddBeanSubmit.ts` | Bean 생성/편집/재입고 제출 로직 (stock_events 기록) |
| **widgets** | `bean-list/ui/BeanList.tsx` | Bean 목록 (stockSummaries prop) |
| **widgets** | `bean-detail/ui/BeanDetail.tsx` | Bean 상세 (useBeanStockSummary) |
| **widgets** | `add-batch-modal/ui/AddBatchModal.tsx` | 배치 생성 + 재고 부족 검사 (useBeanStockSummary) |
| **views** | `bean/index.tsx` | Bean Inventory 페이지 (useBeanStockSummaries) |
| **views** | `active-roast/ActiveRoast.tsx` | 로스팅 완료 → `beanStockEventApi.insert` 차감 (lines 1064-1116) |
| **views** | `dashboard/useDashboard.ts` | `fetchDashboard()` → `getStockSummariesByUser()` (line 73) |
| **shared** | `types/database.types.ts` | 모든 DB 타입 (bean_inventory_logs, bean_stock_events, beans, roast_plan_batches) |
| **DB** | `migrations/20260611065045_add_blends_and_stock_tables.sql` | bean_stock_events 테이블 + 기존 stock_grams → event 마이그레이션 |
