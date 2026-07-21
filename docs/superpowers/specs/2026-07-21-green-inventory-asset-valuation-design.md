# Green bean inventory asset valuation

**Date:** 2026-07-21  
**Status:** Draft for review  
**Scope:** v1 — green beans only; Inventory 생두 탭 표시

## Problem

창고 생두 재고를 자산 금액으로 보여 세금·재무 근거로 쓰려면, 현재 재고(kg)와 매입 단가를 결합한 **재고 자산 평가**가 필요하다.

이미 있는 데이터:

| 소스 | 역할 |
|------|------|
| `bean_stock_events` (ledger) | 현재 재고(g) 집계 |
| `bean_stock_events.cost_per_kg` on `purchase` | 입고 시점 단가 이력 ([INV7] 구현됨) |
| `beans.cost_per_kg` | 마스터 최신 단가 (가격 계산·폴백) |

없는 것: 가중평균 단가 파생, 품목·총 자산 UI.

## Goals

1. 품목별 생두 재고 자산을 **구매 이력 가중평균 단가**로 계산한다.
2. Inventory **생두 탭**에서 총 자산 + 품목별 자산/단가를 본다.
3. 단가 미입력 품목을 합계에서 분리해 표시한다 (매입 근거 신뢰도).
4. 스키마 변경 없이 파생 계산만 추가한다.

## Non-goals (v1)

- 로스팅 원두 / 제품 재고 자산
- FIFO 로트 (`bean_lots`)
- 영구(이동) 가중평균 이벤트 리플레이
- 기간 스냅샷, CSV/인쇄 리포트, 회계 연동
- 통화 설정 UI (표시는 앱 기본 숫자 포맷; 저장 단위는 기존 `cost_per_kg`와 동일)

## Valuation method

### Formula (purchase-history WAC)

Bean \(b\):

```
purchases_with_cost = bean_stock_events
  WHERE bean_id = b
    AND event_type = 'purchase'
    AND cost_per_kg IS NOT NULL
    AND delta_grams > 0

weighted_avg_cost_per_kg =
  Σ(delta_grams × cost_per_kg) / Σ(delta_grams)

asset_value =
  (current_grams / 1000) × unit_cost_per_kg
```

`current_grams` = 기존 stock summary (`get_user_stock_summaries` / `currentGrams`). 음수 재고는 0으로 클램프하지 않고 그대로 두면 음수 자산이 될 수 있으므로, **표시·합계에서는 `max(0, current_grams)`** 를 사용한다.

### Unit cost resolution (priority)

1. **WAC** — `purchases_with_cost`가 1건 이상이면 `weighted_avg_cost_per_kg`
2. **Master fallback** — WAC 불가이고 `beans.cost_per_kg IS NOT NULL`이면 그 값  
   UI에 “마스터 단가” 출처 표시
3. **Unevaluated** — 둘 다 없으면 자산 `null`, 총합에서 제외, “단가 미입력” 카운트

### Known limitation

구매 이력 WAC는 **이미 소진된 입고분도 평균에 포함**한다. 잔량 원가 베이스와 어긋날 수 있다.  
v1은 마이그레이션 주석([`20260729000000_bean_purchase_cost.sql`](../../../supabase/migrations/20260729000000_bean_purchase_cost.sql))과 동일한 단순식을 채택한다.  
정밀도가 필요하면 후속: 영구 WAC 리플레이 또는 FIFO 로트.

## Architecture

### Layers (FSD)

| Layer | Responsibility |
|-------|----------------|
| `shared/lib` | Pure: `calcPurchaseWeightedAvgCost`, `calcInventoryAsset` (g, cost/kg → value). Domain-agnostic number math only if truly generic; otherwise keep under entity/feature. Prefer **`entities/bean` or `entities/bean-stock-event` lib** for bean-specific valuation. |
| `entities/bean-stock-event` | Fetch purchase costs (or asset summary). Types: `BeanAssetLine`, `GreenInventoryAssetSummary`. |
| `features` or view composition | Optional thin hook `useGreenInventoryAssets(userId)` composing beans + stock + cost lines. |
| `views/bean` + `widgets/bean-list`, `widgets/bean-detail` | Display only; no valuation logic inline. |

**SRP:** valuation pure functions in one lib module; data fetch in entity API; UI shows precomputed lines.

### Data flow

```
useBeans(userId) ──┐
useBeanStockSummaries(userId) ──┼──► useGreenInventoryAssets
purchase cost aggregates ───────┘         │
                                          ▼
                    { lines[], totalAsset, unevaluatedCount }
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
            Green tab header        BeanList row          BeanDetail fields
```

### Fetch strategy (choose A unless proven slow)

**A — Client aggregate (default for v1)**

1. Existing: beans list + stock summaries (already loaded on Beans view).
2. New query: purchase events with cost for user beans, minimal columns:

   ```ts
   // conceptual
   from('bean_stock_events')
     .select('bean_id, delta_grams, cost_per_kg')
     .eq('user_id', userId)
     .eq('event_type', 'purchase')
     .not('cost_per_kg', 'is', null)
     .gt('delta_grams', 0)
   ```

3. Group by `bean_id` in pure lib → WAC map.
4. Join with stock + master `cost_per_kg`.

Pros: no migration/RPC, reuses RLS.  
Cons: all purchase rows over time; fine for typical roastery scale. If row counts grow, switch to B.

**B — RPC (defer)**

`get_user_green_inventory_assets(p_user_id)` returning jsonb per bean:  
`{ weighted_avg_cost_per_kg, purchase_grams_with_cost, asset_value, cost_source }`.  
Only if client query is slow or we need server-side consistency for future reports.

### Types (illustrative)

```ts
type CostSource = 'wac' | 'master' | 'none';

type BeanAssetLine = {
  beanId: string;
  currentGrams: number;       // raw summary
  valuedGrams: number;        // max(0, currentGrams)
  unitCostPerKg: number | null;
  costSource: CostSource;
  assetValue: number | null;  // valuedGrams/1000 * unitCost, or null
};

type GreenInventoryAssetSummary = {
  lines: BeanAssetLine[];
  totalAssetValue: number;    // sum of non-null assetValue
  unevaluatedCount: number;   // costSource === 'none' && valuedGrams > 0
  evaluatedCount: number;
};
```

### Pure functions

```ts
// entities/bean-stock-event/lib/asset-value.ts (or entities/bean/lib)

calcPurchaseWeightedAvgCost(
  events: { delta_grams: number; cost_per_kg: number }[]
): number | null
// null if no valid grams

resolveUnitCost(
  wac: number | null,
  masterCostPerKg: number | null
): { unitCostPerKg: number | null; costSource: CostSource }

calcBeanAssetLine(
  beanId, currentGrams, wac, masterCostPerKg
): BeanAssetLine

sumGreenInventoryAssets(lines: BeanAssetLine[]): GreenInventoryAssetSummary
```

No React, no supabase in pure module. Unit tests cover WAC, fallback, zero stock, missing cost, negative stock clamp for valuation only.

## UI

### Placement: Inventory → 생두 탭 only

Not dashboard, not roasted/products tabs (v1).

### Header (above list / master panel)

- **총 재고 자산** — formatted currency-like number (e.g. `₩1,234,567` or existing locale number; match pricing widgets if any).
- Subline: `평가 N종 · 단가 미입력 M종` when `M > 0`.
- Zero beans / all zero stock: show `₩0` or `—` consistently (prefer `₩0` when loaded).

### BeanList row

Under stock kg line (or secondary meta):

- `₩{asset}` when evaluated
- `단가 미입력` (muted) when `costSource === 'none'` and stock > 0
- Hide asset line when stock is 0 (optional; prefer show `₩0` only if cost exists — product choice: **hide when valuedGrams === 0** to reduce noise)

Do not clutter badge row; keep status badge as today.

### BeanDetail

Add to existing 2-col grid (or stock section):

| Label | Value |
|-------|--------|
| 가중평균 단가 / Avg cost | `₩X/kg` or master note |
| 재고 자산 / Stock value | `₩Y` |

If `costSource === 'master'`: helper text “입고 단가 이력 없음 · 마스터 단가 사용”.  
If `none`: “단가 미입력 — 입고/수정에서 단가를 입력하세요”.

### i18n

All user-visible strings via `t(...)` (ko/en keys under `beanList` / `beanDetail` / new `inventoryAsset` namespace). No hard-coded Korean in components.

### Loading / error

- Asset query loading: header skeleton or muted `—`; list rows omit asset until ready (stock already shown).
- Error: toast or inline “자산 계산 실패”; do not block bean list.

## Cache / invalidation

- Query key: e.g. `inventoryQueryRoots.beanPurchaseCosts` / `['bean-purchase-costs', userId]`
- Invalidate on: bean stock event insert (purchase/restock), bean create/update (`cost_per_kg`), same paths as existing stock summary invalidation in `bean-stock-event/queries` and bean mutations.

## Security

- No new secrets. RLS already scopes `bean_stock_events` / `beans` by workspace.
- Client must filter by `workspaceOwnerId` (existing `useActiveWorkspace` pattern on Beans view).

## Testing

| Case | Expected |
|------|----------|
| Single purchase 10kg @ 10000, stock 10kg | asset 100_000, source wac |
| Two purchases 5kg@10k + 5kg@20k, stock 10kg | avg 15k, asset 150_000 |
| Purchases with cost but stock 0 | asset 0 or hidden; not unevaluated |
| Purchase without cost, master set | source master, asset from master |
| No cost, no master, stock > 0 | unevaluatedCount++ |
| Negative currentGrams | valuedGrams 0, asset 0 if cost else none |
| Total = sum of evaluated only | unevaluated excluded |

Vitest on pure lib; optional light hook/query test if pattern exists.

## Implementation sketch (order)

1. Pure lib + unit tests  
2. Entity API: list purchase costs by user + types  
3. Query + invalidation wiring  
4. Compose summary hook (view or feature)  
5. BeanList + BeanDetail + green tab header UI + i18n  
6. Manual check on Beans view with restock cost path

## Success criteria

- [ ] 생두 탭에서 총 재고 자산이 purchase WAC(+ master fallback) 기준으로 표시된다.
- [ ] 품목 리스트·디테일에서 자산/단가(출처)를 확인할 수 있다.
- [ ] 단가 없는 재고 품목은 총합에서 빠지고 건수가 보인다.
- [ ] 스키마 마이그레이션 없음.
- [ ] 순수 계산 단위 테스트 통과.
- [ ] 기존 stock/restock/pricing 경로 회귀 없음.

## Follow-ups (out of this spec)

- Roasted / product inventory asset  
- Export / tax snapshot report  
- Perpetual WAC or FIFO lots for tighter cost basis  
- Optional RPC if purchase history volume becomes an issue  

## Decisions log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Valuation | Purchase-history WAC | Matches existing event cost column intent; no schema |
| UI surface | Inventory green tab | Daily ops visibility; report later |
| Fallback | Master `beans.cost_per_kg` | Data already collected; label source |
| Server RPC | Defer | YAGNI until scale |
| Negative stock | Value at 0 grams | Avoid nonsense negative assets in totals |
