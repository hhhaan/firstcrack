# 07 — Integrations Catalog (Pro+)

**Status:** Draft v0.1 · 2026-07-12  
**Gate:** 아래 항목은 **`pro_plus` 또는 `enterprise`** 에서만 full enable.  
**Pro:** 연동 없음 (업셀).  
**Trial:** v0.1 코어 only — [`02-feature-matrix.md`](./02-feature-matrix.md).

## Catalog

| ID | Name | Region | Category | Plan | Status | Notes |
|----|------|--------|----------|------|--------|-------|
| `naver_smart_store` | 네이버 스마트스토어 | KR | Commerce | Pro+ | beta | channel-connect + order-sync 폴링 |
| `cafe24` | 카페24 | KR | Commerce | Pro+ | beta | access_token 붙여넣기 + 폴링 (OAuth 앱 등록은 운영 시) |
| `shopify` | Shopify | Global (US/JP/KR) | Commerce | Pro+ | beta | custom app token + GraphQL 폴링 |
| `toss` | 토스 (Toss Payments 등) | KR | Payments | Pro+ | planned | **Mislabelled for POS work** — prefer `toss_place` (below). PG-only path if ever needed. |
| `toss_place` | Toss Place POS | KR | Commerce/POS | Pro+ | beta | Open API order+payment pull; adapter `toss-place.ts` + plan `docs/agent/toss-place-integration.md` |
| `smaregi` | スマレジ | JP | Commerce/POS | Pro+ | planned | Platform API (OAuth); Premium+ merchants; see `docs/agent/pos-openapi-integrations.md` |
| `square` | Square POS | US, JP | Commerce/POS | Pro+ | planned | Orders/Payments API; café/retail offline sales |

**POS multi-region research SSoT:** [`docs/agent/pos-openapi-integrations.md`](../agent/pos-openapi-integrations.md).  
**Note:** `shopify` already ingests **Shopify POS** orders (same Admin Orders API) — no separate POS platform id.

## Status values

| Status | Meaning |
|--------|---------|
| `planned` | 로드맵, 미구현 |
| `beta` | 제한 고객 |
| `ga` | Pro+ 기본 제공 |
| `enterprise_only` | 맞춤/우선 큐 |
| `deprecated` | 종료 예정 |

## Packaging rules

1. **신규 커머스/결제 연동 기본 게이트 = Pro+** (예외는 `decisions.md` ADR).
2. Enterprise는 Pro+ 연동 **전부** + 우선 구현·맞춤 커넥터 가능.
3. 연동 추가 시: 이 표 + `02-feature-matrix.md` 행 동시 갱신.
4. **국가 노출은 DB 플래그:** Pro+여도 **마켓 국가 플래그**가 꺼져 있으면 UI/API 숨김.  
   예: `US` → Shopify 화면, `KR` → 네이버 스마트스토어(·카페24·토스) 화면.  
   스키마·시드·해석 순서: **[`09-country-feature-flags.md`](./09-country-feature-flags.md)**.
5. 지역 제한 연동은 `country_feature_flags` + (선택) `profile_feature_flags` 오버라이드로 제어. IP 지오만으로 앱 기능을 켜지 않는다.

## Non-integration (stays in core / Pro)

로스터 머신 프로토콜 (Modbus, Phidget, Probat, …), R2 프로파일 스토리지, Supabase auth — **연동 카탈로그 밖**, 플랜 코어.

## Future candidates (not committed)

| Idea | Region | Possible gate |
|------|--------|---------------|
| 자사몰 기타 (Makeshop, 고도몰…) | KR | Pro+ |
| Stripe store / payments-only | US | Pro+ |
| Clover POS | US | Pro+ |
| Lightspeed / Toast POS | US | Pro+ or Enterprise |
| 회계/ERP export | All | Pro+ or Enterprise |

추가 시 Status `planned`로 승격 후에만 세일즈 약속.
