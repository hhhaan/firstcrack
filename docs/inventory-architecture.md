# Inventory Architecture — 3-원장 이벤트 소싱

> 최종 검증: 2026-07-19
> 상태: 생두/벌크 원두/완제품 3-원장 운영 중. RLS 워크스페이스 통일 + 멱등/원자성 보강 완료 (`20260721000000_inventory_ledger_fixes.sql`).

---

## 1. 개요 — 세 개의 원장

모든 재고는 append-only 이벤트 원장의 SUM으로 계산한다. 비정규화 재고 컬럼 없음 (`beans.stock_grams`·`bean_inventory_logs`는 `20260619000001`에서 제거).

| 원장 | 단위 | 대상 | event_type |
|---|---|---|---|
| `bean_stock_events` | g (생두) | bean | `purchase` + / `roast` − / `adjustment` ± / `write_off` − / `expected_inbound` + |
| `roasted_stock_events` | g (벌크 원두) | bean **또는** blend (`single_source` CHECK: 정확히 하나) | `roast_inbound` + / `packaging` − / `blend_consume` − / `blend_produce` + / `adjustment` ± / `write_off` − |
| `product_stock_events` | 봉지 (units) | product | `roast_inbound` + / `order_fulfillment` − / `order_cancel` + / `adjustment` ± / `write_off` − |

- `roasted_stock_events.is_estimate`: 배출량 미실측 시 로스팅 레벨 기반 추정 입고 → 실측 입력 시 `upsert_roasted_inbound` RPC가 같은 세션의 이벤트를 실측으로 교체 (append-only의 유일한 예외).
- 흐름: 생두 `purchase` → 로스팅 `roast`(생두 −) + `roast_inbound`(벌크 +) → 포장 `packaging`(벌크 −) + `roast_inbound`(완제품 +) → 주문 `order_fulfillment`(완제품 −).

## 2. 쓰기 경로

### bean_stock_events (생두)

| 액션 | 코드 위치 | 이벤트 |
|---|---|---|
| Bean 생성/재입고 | `widgets/add-bean-modal/ui/useAddBeanSubmit.ts` | `purchase` (reference_id 없음) |
| 로스트 저장 차감 | `views/active-roast/model/useRoastSaveFlow.ts` → `features/active-roast/model/useDeductRoastStock.ts` | `roast`, ref = session/batch id. 블렌드는 `buildRoastStockEvents`가 성분별 분해 → `insert_stock_events_batch` RPC (단일 트랜잭션) |
| 배치 완료 차감 (스케줄) | `views/schedule/hooks/useScheduleDayView.ts` (`batchGreenNeededGramsFromBatch` — 남은 세션분만) | `roast`, ref = plan_batch.id |

### roasted_stock_events (벌크 원두)

| 액션 | 코드 위치 | 이벤트 |
|---|---|---|
| 로스트 저장 자동 입고 | `features/active-roast/model/useSaveRoast.ts` + `lib/roastedInbound.ts` → `upsert_roasted_inbound` RPC | `roast_inbound`, ref = session.id. 실측 없으면 추정(`is_estimate`) |
| History 배출량 수정 | `views/history/ui/OutputWeightEditor.tsx` → 같은 RPC | 추정 → 실측 교체 (upsert). bean/blend 귀속은 서버가 `roast_sessions`+`roast_plan_batches`에서 해석 |
| 포장 | `features/package-product/model/usePackageProduct.ts` → `insert_packaging_op` RPC | `packaging` −, product `roast_inbound` +와 **한 트랜잭션** |
| 블렌딩 | `features/blend-roasted/model/useBlendRoasted.ts` → `insert_roasted_stock_events_batch` RPC | `blend_consume` −(성분 bean별) + `blend_produce` +, 공유 opId |

### product_stock_events (완제품)

| 액션 | 코드 위치 | 이벤트 |
|---|---|---|
| 포장 입고 | `features/package-product` → `insert_packaging_op` RPC | `roast_inbound` +, ref = 포장 op uuid |
| 주문 이행 | `fulfill_order(p_order_id)` RPC (차감 + `fulfilled_at` 스탬프 단일 트랜잭션) | `order_fulfillment` −, ref = order_line.id |
| 채널 주문 취소 | `supabase/functions/_shared/channels/inbound-actions.ts` (채널 동기화) | `order_cancel` +, ref = order_line.id |

## 3. 멱등성 (unique 인덱스)

재시도 이중 기록은 partial unique + `ON CONFLICT DO NOTHING`으로 차단.

| 원장 | 인덱스 | 근거 마이그레이션 |
|---|---|---|
| bean | `(reference_id, bean_id) WHERE reference_id IS NOT NULL` | `20260619000000` |
| roasted | `(reference_id) WHERE roast_inbound` (세션당 입고 1건, upsert 대상) | `20260720000000` |
| roasted | `(reference_id) WHERE packaging` / `(reference_id) WHERE blend_produce` / `(reference_id, bean_id) WHERE blend_consume` | `20260721000000` |
| product | `(reference_id, product_id, event_type) WHERE reference_id IS NOT NULL` (이행과 취소가 같은 ref 공유, 각각 멱등) | `20260717000000` |

## 4. RLS

세 원장 모두 `has_workspace_access(user_id)` 기반 — 팀 멤버가 오너 워크스페이스 재고를 읽고 쓴다.

- bean/product: `20260718045740_workspace_security.sql`
- roasted: 생성 시점(`20260720`)에 `auth.uid() = user_id`로 남아 있던 것을 `20260721000000`에서 전환. WITH CHECK는 bean_id → `beans`, blend_id → `blends` 소유권 EXISTS 검증 (bean_stock_events 정책 미러).
- 모든 RPC는 `SECURITY INVOKER` — RLS 그대로 적용.

## 5. F3 이중 차감 가드 (저장 경로)

스케줄 "배치 완료"가 ref = plan_batch.id로 생두를 차감한 뒤, 그 배치에 링크된 로스트를 저장하면 ref = session.id로 또 차감되는 구멍이 있었다. `useRoastSaveFlow`가 deduct 직전 `beanStockEventApi.hasRoastDeductionForReference(planBatchId)`로 기존 차감을 확인하고, 있으면 스킵 + 안내 메시지. 가드 조회 실패 시 fail-open (차감 진행 — 저장 플로우를 막는 것보다 낫다).

## 6. 읽기 경로

| 원장 | 집계 | 소비처 |
|---|---|---|
| bean | `getStockSummariesByUser` → `{ currentGrams, reservedGrams, effectiveGrams }`. 예약 = `(batch_count − completed_sessions) × batch_size_kg × 1000` (pending/scheduled) | BeanList / BeanDetail / Dashboard / AddBatchModal |
| roasted | `get_user_roasted_stock` RPC → `'bean:<id>' \| 'blend:<id>'` 키, `{ grams, has_estimate }` | 벌크 재고 뷰, 포장/블렌딩 모달 |
| product | `get_user_product_stock` RPC → product_id별 units | 상품/주문 뷰 |

## 7. 알려진 잔여 한계

| # | 내용 |
|---|---|
| 1 | 수동 `purchase`/adjust는 reference_id null → DB 멱등 보호 없음 (클라이언트 isSubmitting 가드뿐) |
| 2 | `adjustment`/`write_off`는 roasted/product 스키마에 정의돼 있으나 UI 없음 (bean은 있음) |
| 3 | `roast_inbound` 의미가 원장마다 다름 — 벌크 = 로스팅 산출, 완제품 = 포장. 이름만 같음 |
| 4 | 주문 수동 취소 시 재고 복원 경로 없음 — `order_cancel`은 채널 동기화만 기록 |
| 5 | 앱 시작 재고 알림 compute가 auth user id 사용 (`App.tsx` → `useInventoryAlertSync(user?.id)`) — 팀 멤버 로그인으로는 오너 알림이 갱신 안 됨 |
| 6 | 로트(lot) 개념 없음 — Cropster식 로트 추적/트레이서빌리티 불가. 원장은 bean/blend/product 단위 합계뿐 |

## 8. 관련 파일 인덱스

| Layer | File | Role |
|---|---|---|
| entities | `bean-stock-event/api.ts` | bean 원장 CRUD + 요약 + `hasRoastDeductionForReference` |
| entities | `roasted-stock-event/api.ts` | `upsertInbound` / `insertBatch` / 잔량 RPC 래핑 |
| entities | `product-stock-event/api.ts` | `insertPackagingOp` / 잔량 RPC 래핑 |
| features | `active-roast/model/useDeductRoastStock.ts`, `useSaveRoast.ts`, `lib/roastedInbound.ts` | 생두 차감 / 벌크 자동 입고 |
| features | `package-product/`, `blend-roasted/` | 포장 / 블렌딩 이벤트 빌드 + RPC 호출 |
| views | `active-roast/model/useRoastSaveFlow.ts` | 저장 오케스트레이션 + F3 가드 |
| views | `schedule/hooks/useScheduleDayView.ts` | 배치 완료 차감 |
| views | `history/ui/OutputWeightEditor.tsx` | 배출량 수정 → 입고 교체 |
| DB | `20260717000000` / `20260720000000` / `20260721000000` | product / roasted 원장 + ledger fixes |
