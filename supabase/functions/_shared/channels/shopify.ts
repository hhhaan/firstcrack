/**
 * Shopify Admin GraphQL — official docs only.
 *
 * Auth (custom app Admin API access token):
 *   https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin
 *   Header: X-Shopify-Access-Token
 *   Endpoint: POST https://{shop}/admin/api/{version}/graphql.json
 *
 * Orders query:
 *   https://shopify.dev/docs/api/admin-graphql/latest/queries/orders
 *   Filter example (official): orders(first: 10, query: "updated_at:>2019-12-01")
 *   Fields: displayFinancialStatus, displayFulfillmentStatus, totalPriceSet, lineItems, customer, cancelledAt
 *
 * Order object note: default last 60 days unless read_all_orders scope.
 *   https://shopify.dev/docs/api/admin-graphql/latest/objects/Order
 *
 * API version pinned to docs "latest" crawl (2026-07).
 */

import { buildShopifyFulfillmentInput } from './dispatch.ts';
import { nextPollCursor } from './poll-cursor.ts';
import { shopifyToCanonical } from './status-map.ts';
import type {
    CanonicalOrder,
    CanonicalOrderLine,
    ChannelAdapter,
    ChannelSecrets,
    FetchOrdersResult,
    MarkShippedRequest,
    MarkShippedResult,
    PlatformListing,
    PollCursor,
    TestConnectionResult,
} from './types.ts';

const API_VERSION = '2026-07';

/** Order pages walked per sync before the scan is declared incomplete. */
const MAX_ORDER_PAGES = 5;

export interface ShopifySecrets extends ChannelSecrets {
    shop: string;
    access_token: string;
}

function requireShopify(secrets: ChannelSecrets): ShopifySecrets {
    const raw = String(secrets.shop ?? secrets.shop_domain ?? '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
    const access_token = String(secrets.access_token ?? '').trim();
    if (!raw || !access_token) throw new Error('shopify: shop and access_token required');
    const shop = raw.includes('.') ? raw : `${raw}.myshopify.com`;
    return { ...secrets, shop, access_token };
}

async function gql<T>(shop: string, token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
        throw new Error(`shopify ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
        throw new Error(`shopify gql: ${json.errors.map((e) => e.message).join('; ')}`);
    }
    if (!json.data) throw new Error('shopify gql: empty data');
    return json.data;
}

function gidToId(gid: string): string {
    const parts = gid.split('/');
    return parts[parts.length - 1] ?? gid;
}

type ShopifyOrderNode = {
    id: string;
    name: string;
    createdAt: string;
    updatedAt?: string;
    cancelledAt?: string | null;
    displayFinancialStatus?: string | null;
    displayFulfillmentStatus?: string | null;
    totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
    customer?: { displayName?: string; firstName?: string; lastName?: string } | null;
    lineItems?: {
        edges: Array<{
            node: {
                id: string;
                name?: string;
                title?: string;
                quantity: number;
                sku?: string | null;
                originalUnitPriceSet?: { shopMoney?: { amount?: string } };
                variant?: { id?: string; title?: string } | null;
                product?: { id?: string } | null;
            };
        }>;
    };
};

function mapOrder(node: ShopifyOrderNode): CanonicalOrder {
    const status =
        shopifyToCanonical(node.displayFinancialStatus, node.displayFulfillmentStatus, node.cancelledAt) ?? 'paid';

    const lines: CanonicalOrderLine[] = (node.lineItems?.edges ?? []).map(({ node: li }) => {
        const unit = li.originalUnitPriceSet?.shopMoney?.amount;
        const lineStatus =
            status === 'cancelled' ? 'cancelled' : status === 'refunded' ? 'refunded' : 'active';
        return {
            platformLineId: gidToId(li.id),
            platformProductId: li.product?.id ? gidToId(li.product.id) : null,
            platformVariantId: li.variant?.id ? gidToId(li.variant.id) : null,
            title: li.name || li.title || 'Item',
            quantity: li.quantity,
            unitPrice: unit != null ? Number(unit) : null,
            status: lineStatus as CanonicalOrderLine['status'],
        };
    });

    const nameParts = [node.customer?.firstName, node.customer?.lastName].filter(Boolean).join(' ');
    const buyer = node.customer?.displayName || nameParts || null;

    return {
        platformOrderId: gidToId(node.id),
        status,
        orderedAt: node.createdAt,
        buyerName: buyer,
        currency: node.totalPriceSet?.shopMoney?.currencyCode ?? null,
        totalAmount: node.totalPriceSet?.shopMoney?.amount
            ? Number(node.totalPriceSet.shopMoney.amount)
            : null,
        lines,
        raw: node,
    };
}

export const shopifyAdapter: ChannelAdapter = {
    platform: 'shopify',
    capabilities: { webhooks: true, outboundDispatch: true },

    async testConnection(secrets): Promise<TestConnectionResult> {
        const s = requireShopify(secrets);
        const data = await gql<{ shop: { name: string; myshopifyDomain: string } }>(
            s.shop,
            s.access_token,
            `query { shop { name myshopifyDomain } }`,
        );
        return {
            shopIdentifier: data.shop.myshopifyDomain || s.shop,
            displayName: data.shop.name || s.shop,
        };
    },

    async refreshAuth(): Promise<ChannelSecrets | null> {
        return null;
    },

    async fetchOrdersSince(secrets, cursor): Promise<FetchOrdersResult> {
        const s = requireShopify(secrets);
        // Official filter syntax: updated_at:>2019-12-01 (date or datetime)
        const sinceRaw = cursor.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const sinceDay = sinceRaw.slice(0, 10);
        const q = `updated_at:>${sinceDay}`;

        type OrdersData = {
            orders: {
                edges: Array<{ cursor: string; node: ShopifyOrderNode }>;
                pageInfo: { hasNextPage: boolean; endCursor?: string | null };
            };
        };

        const orders: CanonicalOrder[] = [];
        let after: string | undefined = cursor.token;
        let endCursor: string | undefined;
        let hasNextPage = false;
        let pages = 0;

        do {
            const data = await gql<OrdersData>(
                s.shop,
                s.access_token,
                `query ($q: String!, $after: String) {
                  orders(first: 50, query: $q, after: $after, sortKey: UPDATED_AT) {
                    edges {
                      cursor
                      node {
                        id name createdAt updatedAt cancelledAt
                        displayFinancialStatus displayFulfillmentStatus
                        totalPriceSet { shopMoney { amount currencyCode } }
                        customer { displayName firstName lastName }
                        lineItems(first: 50) {
                          edges {
                            node {
                              id name title quantity sku
                              originalUnitPriceSet { shopMoney { amount } }
                              product { id }
                              variant { id title }
                            }
                          }
                        }
                      }
                    }
                    pageInfo { hasNextPage endCursor }
                  }
                }`,
                { q, after },
            );

            for (const edge of data.orders.edges) {
                orders.push(mapOrder(edge.node));
            }
            endCursor = data.orders.pageInfo.endCursor ?? undefined;
            hasNextPage = data.orders.pageInfo.hasNextPage;
            after = endCursor;
            pages += 1;
        } while (hasNextPage && pages < MAX_ORDER_PAGES);

        return {
            orders,
            nextCursor: nextPollCursor({
                complete: !hasNextPage,
                windowEnd: new Date().toISOString(),
                // Keeping `since` also keeps the `updated_at:>` filter identical, which is what
                // makes the stored endCursor a valid resume point on the next run.
                resumeFrom: cursor.since ?? sinceRaw,
                resumeToken: endCursor,
            }),
        };
    },

    async listProducts(secrets): Promise<PlatformListing[]> {
        const s = requireShopify(secrets);
        type ProductsData = {
            products: {
                edges: Array<{
                    node: {
                        id: string;
                        title: string;
                        variants: {
                            edges: Array<{ node: { id: string; sku?: string | null; title: string } }>;
                        };
                    };
                }>;
            };
        };
        const data = await gql<ProductsData>(
            s.shop,
            s.access_token,
            `query {
              products(first: 50) {
                edges {
                  node {
                    id title
                    variants(first: 50) {
                      edges { node { id sku title } }
                    }
                  }
                }
              }
            }`,
        );
        const out: PlatformListing[] = [];
        for (const { node: p } of data.products.edges) {
            for (const { node: v } of p.variants.edges) {
                out.push({
                    platformProductId: gidToId(p.id),
                    platformVariantId: gidToId(v.id),
                    title: `${p.title}${v.title && v.title !== 'Default Title' ? ` — ${v.title}` : ''}`,
                    sku: v.sku ?? null,
                });
            }
        }
        return out;
    },

    async markShipped(secrets, req: MarkShippedRequest): Promise<MarkShippedResult> {
        const s = requireShopify(secrets);
        const orderGid = req.platformOrderId.startsWith('gid://')
            ? req.platformOrderId
            : `gid://shopify/Order/${req.platformOrderId}`;

        type FoData = {
            order: {
                fulfillmentOrders: {
                    edges: Array<{
                        node: {
                            id: string;
                            status: string;
                        };
                    }>;
                };
            } | null;
        };

        const foData = await gql<FoData>(
            s.shop,
            s.access_token,
            `query ($id: ID!) {
              order(id: $id) {
                fulfillmentOrders(first: 20) {
                  edges { node { id status } }
                }
              }
            }`,
            { id: orderGid },
        );

        const openIds = (foData.order?.fulfillmentOrders.edges ?? [])
            .filter((e) => e.node.status === 'OPEN' || e.node.status === 'IN_PROGRESS')
            .map((e) => e.node.id);

        if (!openIds.length) {
            return { ok: true, alreadyShipped: true };
        }

        const fulfillment = buildShopifyFulfillmentInput(req, openIds);
        type CreateData = {
            fulfillmentCreateV2: {
                fulfillment?: { id: string } | null;
                userErrors: Array<{ message: string }>;
            };
        };

        const created = await gql<CreateData>(
            s.shop,
            s.access_token,
            `mutation ($fulfillment: FulfillmentV2Input!) {
              fulfillmentCreateV2(fulfillment: $fulfillment) {
                fulfillment { id }
                userErrors { message }
              }
            }`,
            { fulfillment },
        );

        const errors = created.fulfillmentCreateV2.userErrors ?? [];
        if (errors.length) {
            const msg = errors.map((e) => e.message).join('; ');
            const already = /already|fulfilled|closed/i.test(msg);
            if (already) return { ok: true, alreadyShipped: true, error: msg };
            return { ok: false, alreadyShipped: false, error: msg };
        }
        if (!created.fulfillmentCreateV2.fulfillment?.id) {
            return { ok: false, alreadyShipped: false, error: 'shopify: no fulfillment created' };
        }
        return {
            ok: true,
            alreadyShipped: false,
            lineResults: req.lines.map((l) => ({ platformLineId: l.platformLineId, ok: true })),
        };
    },
};
