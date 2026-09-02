/**
 * In-memory backend for Playwright route mocks.
 * Implements the subset of PostgREST + RPCs the shipped app calls in core flows.
 * F3: save_roast_op skips green deduct when a roast event already exists for plan_batch_id.
 */
import { E2E_USER } from './constants';

export type BeanRow = {
    id: string;
    user_id: string;
    name: string;
    origin: string | null;
    region: string | null;
    farm: string | null;
    process: string | null;
    variety: string | null;
    altitude_masl: number | null;
    capacity_grams: number;
    cost_per_kg: number | null;
    tasting_notes: string | null;
    purchase_date: string | null;
    low_stock_threshold_grams: number | null;
    created_at: string;
    updated_at: string;
};

export type BeanStockEvent = {
    id: string;
    user_id: string;
    bean_id: string;
    delta_grams: number;
    event_type: string;
    reference_id: string | null;
    cost_per_kg: number | null;
    note: string | null;
    created_at: string;
};

export type RoastSession = {
    id: string;
    user_id: string;
    weight_grams: number;
    output_weight_grams: number | null;
    status: string;
    roasted_at: string | null;
    duration_seconds: number | null;
    drop_temp_celsius: number | null;
    roast_level: string | null;
    scheduled_at: string | null;
    notes: string | null;
    ambient_temp_celsius: number | null;
    ambient_humidity_pct: number | null;
    bean_id: string | null;
    profile_id: string | null;
    tsv_path: string | null;
    bbp_tsv_path: string | null;
    bbp_seconds: number | null;
    charge_temp_celsius: number | null;
    plan_batch_id: string | null;
    machine_id: string | null;
    machine_name: string | null;
    machine_roaster_key: string | null;
    machine_brand: string | null;
    machine_protocol: string | null;
    events: unknown;
    created_at: string;
    updated_at: string;
    beans?: { name: string; origin: string | null; region: string | null; variety: string | null; process: string | null; farm: string | null } | null;
    roast_profiles?: { name: string; target_level: string | null } | null;
};

export type PlanBatch = {
    id: string;
    plan_id: string;
    user_id: string;
    scheduled_date: string;
    bean_id: string | null;
    bean_name: string;
    blend_id: string | null;
    batch_size_kg: number;
    batch_count: number;
    completed_sessions: number;
    status: string;
    sort_order: number;
    created_at: string;
};

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

export class MockDb {
    beans: BeanRow[] = [];
    stockEvents: BeanStockEvent[] = [];
    sessions: RoastSession[] = [];
    planBatches: PlanBatch[] = [];
    dayPlans: { id: string; user_id: string; plan_date: string }[] = [];
    roastedEvents: { id: string; reference_id: string | null; delta_grams: number; event_type: string }[] = [];
    /** Last save_roast_op deduct decision — asserted by F3 e2e. */
    lastSaveOpDeductApplied = false;
    lastSaveOpRequestedDeduct = false;

    reset() {
        this.beans = [];
        this.stockEvents = [];
        this.sessions = [];
        this.planBatches = [];
        this.dayPlans = [];
        this.roastedEvents = [];
        this.lastSaveOpDeductApplied = false;
        this.lastSaveOpRequestedDeduct = false;
    }

    seedBean(partial?: Partial<BeanRow> & { stockGrams?: number }): BeanRow {
        const bean: BeanRow = {
            id: partial?.id ?? uuid(),
            user_id: partial?.user_id ?? E2E_USER.id,
            name: partial?.name ?? 'E2E Ethiopia',
            origin: partial?.origin ?? 'Ethiopia',
            region: partial?.region ?? null,
            farm: partial?.farm ?? null,
            process: partial?.process ?? 'Washed',
            variety: partial?.variety ?? null,
            altitude_masl: partial?.altitude_masl ?? null,
            capacity_grams: partial?.capacity_grams ?? 10_000,
            cost_per_kg: partial?.cost_per_kg ?? 20_000,
            tasting_notes: partial?.tasting_notes ?? null,
            purchase_date: partial?.purchase_date ?? nowIso().slice(0, 10),
            low_stock_threshold_grams: partial?.low_stock_threshold_grams ?? 1000,
            created_at: nowIso(),
            updated_at: nowIso(),
        };
        this.beans.unshift(bean);
        const stockGrams = partial?.stockGrams ?? 0;
        if (stockGrams > 0) {
            this.insertStockEvent({
                user_id: bean.user_id,
                bean_id: bean.id,
                delta_grams: stockGrams,
                event_type: 'purchase',
                reference_id: uuid(),
                cost_per_kg: bean.cost_per_kg,
            });
        }
        return bean;
    }

    insertStockEvent(event: {
        user_id: string;
        bean_id: string;
        delta_grams: number;
        event_type: string;
        reference_id?: string | null;
        cost_per_kg?: number | null;
        note?: string | null;
    }): BeanStockEvent {
        const row: BeanStockEvent = {
            id: uuid(),
            user_id: event.user_id,
            bean_id: event.bean_id,
            delta_grams: event.delta_grams,
            event_type: event.event_type,
            reference_id: event.reference_id ?? null,
            cost_per_kg: event.cost_per_kg ?? null,
            note: event.note ?? null,
            created_at: nowIso(),
        };
        this.stockEvents.unshift(row);
        return row;
    }

    beanStockGrams(beanId: string): number {
        return this.stockEvents.filter((e) => e.bean_id === beanId).reduce((s, e) => s + e.delta_grams, 0);
    }

    stockSummary(beanId: string) {
        const current = this.beanStockGrams(beanId);
        return {
            current_grams: current,
            available_grams: current,
            reserved_grams: 0,
            effective_grams: current,
            // camelCase variants some parsers accept
            currentGrams: current,
            availableGrams: current,
            reservedGrams: 0,
            effectiveGrams: current,
        };
    }

    userStockSummaries(userId: string) {
        const out: Record<string, ReturnType<MockDb['stockSummary']>> = {};
        for (const b of this.beans.filter((x) => x.user_id === userId)) {
            out[b.id] = this.stockSummary(b.id);
        }
        return out;
    }

    hasRoastDeductionForReference(referenceId: string): boolean {
        return this.stockEvents.some((e) => e.reference_id === referenceId && e.event_type === 'roast');
    }

    seedPlanBatchWithDeduction(opts: {
        beanId: string;
        beanName: string;
        batchSizeKg?: number;
        batchCount?: number;
    }): PlanBatch {
        const planId = uuid();
        const date = nowIso().slice(0, 10);
        this.dayPlans.push({ id: planId, user_id: E2E_USER.id, plan_date: date });
        const batch: PlanBatch = {
            id: uuid(),
            plan_id: planId,
            user_id: E2E_USER.id,
            scheduled_date: date,
            bean_id: opts.beanId,
            bean_name: opts.beanName,
            blend_id: null,
            batch_size_kg: opts.batchSizeKg ?? 5,
            batch_count: opts.batchCount ?? 1,
            completed_sessions: 0,
            status: 'planned',
            sort_order: 0,
            created_at: nowIso(),
        };
        this.planBatches.push(batch);
        // Schedule complete already claimed green (F3 reference = plan_batch.id)
        const remaining = batch.batch_count - batch.completed_sessions;
        const grams = Math.round(batch.batch_size_kg * remaining * 1000);
        this.insertStockEvent({
            user_id: E2E_USER.id,
            bean_id: opts.beanId,
            delta_grams: -grams,
            event_type: 'roast',
            reference_id: batch.id,
        });
        return batch;
    }

    /**
     * Mirrors production save_roast_op C2: skip deduct when plan_batch already has roast event.
     */
    saveRoastOp(params: {
        session: Record<string, unknown>;
        deduct: boolean;
        deductionGrams: number;
        inboundGrams: number;
        inboundIsEstimate: boolean;
    }): RoastSession {
        this.lastSaveOpRequestedDeduct = params.deduct;
        const sessionId = uuid();
        const beanId = (params.session.bean_id as string | null) ?? null;
        const planBatchId = (params.session.plan_batch_id as string | null) ?? null;
        const userId = (params.session.user_id as string) ?? E2E_USER.id;

        let applyDeduct = params.deduct && params.deductionGrams > 0 && !!beanId;
        if (applyDeduct && planBatchId && this.hasRoastDeductionForReference(planBatchId)) {
            applyDeduct = false;
        }
        this.lastSaveOpDeductApplied = applyDeduct;

        if (applyDeduct && beanId) {
            this.insertStockEvent({
                user_id: userId,
                bean_id: beanId,
                delta_grams: -Math.abs(params.deductionGrams),
                event_type: 'roast',
                reference_id: sessionId,
            });
        }

        if (params.inboundGrams > 0) {
            this.roastedEvents.push({
                id: uuid(),
                reference_id: sessionId,
                delta_grams: params.inboundGrams,
                event_type: 'roast_inbound',
            });
        }

        const bean = beanId ? this.beans.find((b) => b.id === beanId) : null;
        const row: RoastSession = {
            id: sessionId,
            user_id: userId,
            weight_grams: Number(params.session.weight_grams) || 0,
            output_weight_grams: (params.session.output_weight_grams as number | null) ?? null,
            status: (params.session.status as string) || 'completed',
            roasted_at: (params.session.roasted_at as string) || nowIso(),
            duration_seconds: (params.session.duration_seconds as number | null) ?? null,
            drop_temp_celsius: (params.session.drop_temp_celsius as number | null) ?? null,
            roast_level: (params.session.roast_level as string | null) ?? null,
            scheduled_at: null,
            notes: (params.session.notes as string | null) ?? null,
            ambient_temp_celsius: (params.session.ambient_temp_celsius as number | null) ?? null,
            ambient_humidity_pct: (params.session.ambient_humidity_pct as number | null) ?? null,
            bean_id: beanId,
            profile_id: (params.session.profile_id as string | null) ?? null,
            tsv_path: null,
            bbp_tsv_path: null,
            bbp_seconds: (params.session.bbp_seconds as number | null) ?? null,
            charge_temp_celsius: (params.session.charge_temp_celsius as number | null) ?? null,
            plan_batch_id: planBatchId,
            machine_id: (params.session.machine_id as string | null) ?? null,
            machine_name: (params.session.machine_name as string | null) ?? null,
            machine_roaster_key: (params.session.machine_roaster_key as string | null) ?? null,
            machine_brand: (params.session.machine_brand as string | null) ?? null,
            machine_protocol: (params.session.machine_protocol as string | null) ?? null,
            events: params.session.events ?? [],
            created_at: nowIso(),
            updated_at: nowIso(),
            beans: bean
                ? {
                      name: bean.name,
                      origin: bean.origin,
                      region: bean.region,
                      variety: bean.variety,
                      process: bean.process,
                      farm: bean.farm,
                  }
                : null,
            roast_profiles: null,
        };
        this.sessions.unshift(row);

        if (planBatchId) {
            const batch = this.planBatches.find((b) => b.id === planBatchId);
            if (batch) {
                batch.completed_sessions += 1;
                if (batch.completed_sessions >= batch.batch_count) batch.status = 'done';
            }
        }

        return row;
    }

    createBean(body: Record<string, unknown>): BeanRow {
        return this.seedBean({
            user_id: (body.user_id as string) || E2E_USER.id,
            name: (body.name as string) || 'Untitled',
            origin: (body.origin as string | null) ?? null,
            region: (body.region as string | null) ?? null,
            farm: (body.farm as string | null) ?? null,
            process: (body.process as string | null) ?? null,
            variety: (body.variety as string | null) ?? null,
            altitude_masl: (body.altitude_masl as number | null) ?? null,
            capacity_grams: (body.capacity_grams as number) || 5000,
            cost_per_kg: (body.cost_per_kg as number | null) ?? null,
            tasting_notes: (body.tasting_notes as string | null) ?? null,
            purchase_date: (body.purchase_date as string | null) ?? nowIso().slice(0, 10),
            stockGrams: 0,
        });
    }
}
