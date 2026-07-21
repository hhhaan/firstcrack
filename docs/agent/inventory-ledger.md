# Inventory ledger — agent quick index

**SSoT:** [`docs/inventory-architecture.md`](../inventory-architecture.md) (English, tracked).

Use that file for purpose, three ledgers, write paths, RPCs, idempotency, RLS, F3 double-deduct, and file index.

## Entry points

| Ledger | Entity API | Common writers |
|--------|------------|----------------|
| green | `src/entities/bean-stock-event/api.ts` | roast save, schedule complete, add-bean |
| bulk | `src/entities/roasted-stock-event/api.ts` | `upsert_roasted_inbound`, package, blend |
| product | `src/entities/product-stock-event/api.ts` | package, `fulfill_order`, `cancel_order` |

Invalidate via `inventoryQueryRoots` in `src/shared/lib/query-keys.ts`.

**Do not:**

- Add denormalized stock columns on beans/products
- Client multi-table inserts for packaging / fulfill / roast save
- New `event_type` values without a migration + unique index plan
- Write with `auth.user.id` when `workspaceOwnerId` differs
