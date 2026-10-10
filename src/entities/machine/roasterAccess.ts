/** Giesen W45A / W60A. Account plan must be enterprise. Tester is the internal mirror. */
const ENTERPRISE_ONLY_ROASTER_KEYS = new Set(['giesen_w45a_w60a']);
const ENTERPRISE_ACCOUNT_PLANS = new Set(['enterprise', 'tester']);

export const roasterRequiresEnterprise = (roasterKey: string): boolean => ENTERPRISE_ONLY_ROASTER_KEYS.has(roasterKey);

export const canConnectRoaster = (roasterKey: string, plan: string | null | undefined): boolean =>
    !roasterRequiresEnterprise(roasterKey) || ENTERPRISE_ACCOUNT_PLANS.has(plan ?? '');
