import { FEATURE, type FeatureKey } from './keys';

/** Event trials have tester features, but are neither paid nor unlimited trials. */
/** `tester` is internal-only, entitled exactly like enterprise. Never sold — set by hand. */
const PAID_PLANS = new Set(['pro', 'team', 'pro_plus', 'tester', 'enterprise']);

/** Pro+ 이상. Legacy `team` maps to enterprise-class. */
const PRO_PLUS_PLANS = new Set(['pro_plus', 'tester', 'enterprise', 'team', 'trial-event']);

/** E-commerce order integration + team host: enterprise-class (tester internal mirror). */
const ORDER_INTEGRATION_PLANS = new Set(['enterprise', 'team', 'tester', 'trial-event']);

export function isPaidPlan(plan: string): boolean {
    return PAID_PLANS.has(plan);
}

/** Trial runs at Pro core level; read_only (and legacy free) get nothing. */
export function isCoreEntitled(plan: string): boolean {
    return plan === 'trial' || plan === 'trial-event' || isPaidPlan(plan);
}

/** Known writable plans only — unknown/garbage strings are not writable. */
export function isWritablePlan(plan: string): boolean {
    return isCoreEntitled(plan) || plan === 'free';
}

const FEATURE_PREDICATE = {
    [FEATURE.cupping]: isCoreEntitled,
    [FEATURE.bbp]: () => true,
    [FEATURE.fastPolling]: isCoreEntitled,
    [FEATURE.orderIntegration]: (plan: string) => ORDER_INTEGRATION_PLANS.has(plan),
    [FEATURE.customMachineControl]: (plan: string) => ORDER_INTEGRATION_PLANS.has(plan),
    [FEATURE.team]: (plan: string) => ORDER_INTEGRATION_PLANS.has(plan),
    [FEATURE.roastedInventory]: (plan: string) => PRO_PLUS_PLANS.has(plan),
    [FEATURE.productStock]: (plan: string) => PRO_PLUS_PLANS.has(plan),
    [FEATURE.machineControl]: isCoreEntitled,
    [FEATURE.machineReplay]: (plan: string) => PRO_PLUS_PLANS.has(plan),
    /** Never a plan entitlement. Turn on with profiles.simulator_enabled. */
    [FEATURE.simulator]: () => false,
} satisfies Record<FeatureKey, (plan: string) => boolean>;

/** Plan → feature. Only place that encodes “who gets what”. Exhaustive on FeatureKey. */
export function planHasFeature(plan: string, key: FeatureKey): boolean {
    return FEATURE_PREDICATE[key]?.(plan) ?? false;
}

/**
 * Max registered real machines (Virtual excluded).
 * `null` = unlimited.
 * Below Pro+: 1 machine. Pro+ / enterprise / legacy team: unlimited.
 */
export function planMaxMachines(plan: string): number | null {
    if (PRO_PLUS_PLANS.has(plan)) return null;
    return 1;
}

export function canAddMachine(plan: string, realMachineCount: number): boolean {
    const max = planMaxMachines(plan);
    if (max == null) return true;
    return realMachineCount < max;
}

/** Charges per UTC calendar month. `null` = unlimited. Pro = 200; Pro+ = unlimited. */
// Anchors parsed by scripts/check-plan-caps.mjs (parity with the SQL batch-gate migration).
// Keep the `NAME = <number>` shape — if you change the format, update the script.
export const PRO_MONTHLY_BATCH_CAP = 200;

/** Trial ends at whichever comes first: 14 days from signup or 20 lifetime Charges. */
export const TRIAL_DURATION_DAYS = 14;
export const TRIAL_BATCH_CAP = 20;

/** Explicitly enrolled outreach accounts; independent of signup and the ordinary trial. */
export const TRIAL_EVENT_DURATION_DAYS = 90;
export const TRIAL_EVENT_BATCH_CAP = 100;

export function planMaxBatchesPerMonth(plan: string): number | null {
    if (PRO_PLUS_PLANS.has(plan)) return null;
    if (plan === 'read_only') return 0;
    return PRO_MONTHLY_BATCH_CAP;
}

export function planChargeCap(plan: string): number | null {
    if (plan === 'trial') return TRIAL_BATCH_CAP;
    if (plan === 'trial-event') return TRIAL_EVENT_BATCH_CAP;
    return planMaxBatchesPerMonth(plan);
}

export function canStartCharge(plan: string, chargesInPeriod: number): boolean {
    const max = planChargeCap(plan);
    if (max == null) return true;
    return chargesInPeriod < max;
}

/** Matches the RAISE codes of the server batch gate (enforce_batch_gate / profile_write_error). */
export type BatchGateCode =
    | 'monthly_batch_cap'
    | 'trial_batch_cap'
    | 'trial_expired'
    | 'trial_event_batch_cap'
    | 'trial_event_expired'
    | 'read_only_plan';

const GATE_MESSAGES: Record<BatchGateCode, (used: number, max: number) => string> = {
    monthly_batch_cap: (used, max) =>
        `Monthly batch limit reached (${used}/${max}). Upgrade to Pro+ for unlimited batches.`,
    trial_batch_cap: (used, max) => `Trial batch limit reached (${used}/${max}). Upgrade to keep roasting.`,
    trial_expired: () => 'Trial period has ended. Upgrade to keep roasting.',
    trial_event_batch_cap: (used, max) => `Trial batch limit reached (${used}/${max}). Upgrade to keep roasting.`,
    trial_event_expired: () => 'Trial period has ended. Upgrade to keep roasting.',
    read_only_plan: () => 'Subscription inactive — account is read-only. Upgrade to keep roasting.',
};

export class BatchLimitError extends Error {
    readonly used: number;
    readonly max: number;
    readonly code: BatchGateCode;

    constructor(used: number, max: number, code: BatchGateCode = 'monthly_batch_cap') {
        super(GATE_MESSAGES[code](used, max));
        this.name = 'BatchLimitError';
        this.used = used;
        this.max = max;
        this.code = code;
    }
}

/** PostgrestError is a plain object, not an Error — and the RAISE DETAIL lands in `details`. */
function gateErrorText(e: unknown): string {
    if (e && typeof e === 'object') {
        const o = e as { message?: unknown; details?: unknown };
        if (o.message != null || o.details != null) return `${o.message ?? ''} ${o.details ?? ''}`;
    }
    return String(e);
}

/** Server gate RAISE → typed error (client pre-checks can be bypassed; this catches the authority path). */
export function mapServerBatchGateError(e: unknown): BatchLimitError | null {
    const msg = gateErrorText(e);
    if (msg.includes('trial_event_batch_cap'))
        return new BatchLimitError(TRIAL_EVENT_BATCH_CAP, TRIAL_EVENT_BATCH_CAP, 'trial_event_batch_cap');
    if (msg.includes('trial_event_expired')) return new BatchLimitError(0, 0, 'trial_event_expired');
    if (msg.includes('monthly_batch_cap')) {
        // DETAIL 'used=N cap=M' is the server's own number — the constant only covers a parse miss,
        // so a cap change deployed ahead of the app release still reports truthfully.
        const detail = /used=(\d+) cap=(\d+)/.exec(msg);
        if (detail) return new BatchLimitError(Number(detail[1]), Number(detail[2]));
        return new BatchLimitError(PRO_MONTHLY_BATCH_CAP, PRO_MONTHLY_BATCH_CAP);
    }
    if (msg.includes('trial_batch_cap'))
        return new BatchLimitError(TRIAL_BATCH_CAP, TRIAL_BATCH_CAP, 'trial_batch_cap');
    if (msg.includes('trial_expired')) return new BatchLimitError(0, 0, 'trial_expired');
    if (msg.includes('read_only_plan')) return new BatchLimitError(0, 0, 'read_only_plan');
    return null;
}
