# Inventory Ledger Fixes — 감사에서 확인된 4버그 수정

> **Status:** Shipped · 2026-07-19
> **Source:** 3-원장 파이프라인 감사 (bean / roasted / product stock events). 상세 진단은 세션 기록, 배경은 `docs/inventory-architecture.md`(stale)와 `plans/roasted-inventory.md`.

## 버그 목록과 수정 전략

### F1. `roasted_stock_events` RLS 워크스페이스 미적용 (치명)
7/18 워크스페이스 마이그레이션 이후에 만들어졌는데 `auth.uid() = user_id` 정책 그대로 → 팀 멤버는 읽기 빈 값·쓰기 전부 실패. 포장 시 완제품 +units만 성공하는 반쪽 기록 100% 재현.
**수정:** 정책을 `has_workspace_access(user_id)` 기반으로 교체 (`bean_stock_events` 정책 미러: USING has_workspace_access + WITH CHECK 소유권 EXISTS — bean_id는 beans, blend_id는 blends 소유 확인).

### F2. 포장 비원자성 + 벌크 멱등 부재
`usePackageProduct`가 product RPC → roasted RPC 순차 2회 호출. 중간 실패 시 원장 어긋남. roasted 쪽 packaging/blend 이벤트는 unique 보호 없음(재시도 이중 차감).
**수정:** 단일 RPC `insert_packaging_op(p_product_events jsonb, p_roasted_events jsonb)` — 한 트랜잭션. roasted에 partial unique 추가: `(reference_id) WHERE 'packaging'`, `(reference_id) WHERE 'blend_produce'`, `(reference_id, bean_id) WHERE 'blend_consume'` + 배치 insert `ON CONFLICT DO NOTHING`.

### F3. 생두 이중 차감 (배치 완료 → 로스트 저장 방향)
스케줄 "배치 완료" 차감은 남은 세션분만 계산(`batchGreenNeededGrams`)이라 절반은 안전. 구멍: 완료된 배치(ref=batch.id로 차감됨)에 링크된 로스트를 이후 저장하며 차감 체크 → session.id ref로 또 차감.
**수정:** 저장 경로 가드 — deduct 직전에 `bean_stock_events`에 `reference_id = planBatchId` 차감이 이미 있으면 스킵 + 안내. 신규 api `beanStockEventApi.hasDeductionForReference(referenceId): Promise<boolean>` (limit 1 select).

### F4. History 배출량 수정 시 블렌드 귀속 소실
`OutputWeightEditor`가 `blendId: null` 하드코딩. upsert의 UPDATE는 귀속을 안 건드려서 기존 입고가 있으면 무해하지만, 입고가 없던 세션(입고 실패/과거 세션)은 잘못된 bean 귀속으로 INSERT.
**수정:** 귀속 결정을 서버로 이동 — `upsert_roasted_inbound(p_session_id, p_user_id, p_grams, p_is_estimate)`로 시그니처 축소, 함수 내부에서 `roast_sessions.bean_id` + `roast_plan_batches.blend_id`로 귀속 해석. 클라이언트 양쪽 호출부 단순화, `buildRoastedInbound`는 grams/isEstimate 계산만 남김.

## 태스크 (서브에이전트 단위)

| # | 내용 | 파일 |
|---|------|------|
| T1 | 마이그레이션 1개: F1 정책 교체 + F2 RPC/인덱스 + F4 RPC v2 (스키마 무변경 → `SKIP_TYPES_GEN=1` 커밋) | `supabase/migrations/20260721000000_inventory_ledger_fixes.sql` |
| T2 | F2 클라이언트: `insertPackagingOp` api + `usePackageProduct` 단일 호출화 | `entities/roasted-stock-event/api.ts`(또는 product 쪽), `features/package-product/` |
| T3 | F4 클라이언트: `upsertInbound` 시그니처 축소, 호출부 2곳, `roastedInbound.ts`+테스트 | `entities/roasted-stock-event/`, `features/active-roast/`, `views/history/ui/OutputWeightEditor.tsx` |
| T4 | F3 가드: `hasDeductionForReference` + `useRoastSaveFlow` 스킵 + i18n 4로케일 | `entities/bean-stock-event/api.ts`, `views/active-roast/model/useRoastSaveFlow.ts` |
| T5 | `docs/inventory-architecture.md` 3-원장 현행화 + `verify:all` | docs |

각 태스크 완료 시 개별 커밋(`ai-commit.sh`), 최종 `pnpm verify:all` 그린.

**완료:** 4커밋 반영 — T1 마이그레이션(`20260721000000_inventory_ledger_fixes.sql`), T2 원자적 포장 RPC 클라이언트, T3 입고 귀속 서버 결정, T4 저장 경로 이중 차감 가드. T5에서 `docs/inventory-architecture.md` 3-원장 현행화.
