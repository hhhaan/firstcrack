export const OLD_POLAR_ORG = 'f0ef6666-e89c-4a50-8808-78ff4b4d3a1d';
export const NEW_POLAR_ORG = '3b6494cb-8248-47d1-a5f2-65ff7ca9b8a8';
type Env = (name: string) => string | undefined;
export function polarPlans(env: Env, org: string): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [key, plan] of [['PRO', 'pro'], ['PRO_PLUS', 'pro_plus']] as const) {
        const prefix = org === OLD_POLAR_ORG ? 'POLAR_LEGACY_' : 'POLAR_';
        for (const market of ['US', 'KR', 'JP']) {
            for (const suffix of ['', '_YEARLY']) {
                const id = env(`${prefix}${key}_PRODUCT_ID_${market}${suffix}`);
                if (id) map[id] = plan;
            }
        }
    }
    if (org === OLD_POLAR_ORG) {
        for (const [key, plan] of [['PRO', 'pro'], ['PRO_PLUS', 'pro_plus'], ['ENTERPRISE', 'enterprise']]) {
            const id = env(`POLAR_LEGACY_${key}_PRODUCT_ID`) ?? env(`POLAR_${key}_PRODUCT_ID`);
            if (id) map[id] = plan;
        }
    }
    return map;
}
export function checkoutProduct(key: unknown, env: Env): string | undefined {
    if (typeof key !== 'string' || !/^POLAR_(PRO|PRO_PLUS)_PRODUCT_ID_(US|KR|JP)$/.test(key)) return;
    return env(key);
}
export function polarUser(data: Record<string, unknown>): string | null {
    const customer = data.customer as Record<string, unknown> | undefined;
    const metadata = data.metadata as Record<string, unknown> | undefined;
    const external = customer?.external_id;
    const meta = metadata?.user_id;
    if (external && meta && external !== meta) throw new Error('Conflicting Polar user identity');
    const id = external ?? meta;
    if (id == null) return null;
    if (typeof id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('Invalid Polar user identity');
    }
    return id;
}
