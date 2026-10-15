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
    heater_events?: unknown;
    created_at: string;
    updated_at: string;
    beans?: {
        name: string;
        origin: string | null;
        region: string | null;
        variety: string | null;
        process: string | null;
        farm: string | null;
    } | null;
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

const ADDABLE_RECORD_EVENTS = new Set(['TP', 'Yellow', 'FC Start', 'FC Rolling', 'FC End']);
const RECORD_EVENT_RANK: Record<string, number> = {
    Charge: 0,
    TP: 1,
    Yellow: 2,
    'FC Start': 3,
    'FC Rolling': 4,
    'FC End': 5,
    Drop: 6,
    End: 7,
};

const asEventRecord = (e: unknown): Record<string, unknown> | null =>
    e != null && typeof e === 'object' && !Array.isArray(e) ? (e as Record<string, unknown>) : null;

const eventId = (e: Record<string, unknown>): string | null => (typeof e.id === 'string' && e.id ? e.id : null);

/** Existing rows of these types cannot be removed. */
const UNDELETABLE_RECORD_EVENTS = new Set(['Charge', 'Drop', 'Now', 'Control']);
/** New rows of these types are rejected. End may be removed, not inserted. */
const CLOSED_RECORD_EVENTS = new Set(['Charge', 'Drop', 'End', 'Heater', 'Now', 'Control']);

/** Mirrors update_roast_session_record: time/temp edits, notes, custom marks, and one missing TP/Yellow/FC. */
const recordEventsEditOk = (prevRaw: unknown, nextRaw: unknown): boolean => {
    if (!Array.isArray(nextRaw)) return false;
    const prev = (Array.isArray(prevRaw) ? prevRaw : []).map(asEventRecord);
    const next = nextRaw.map(asEventRecord);
    if (prev.some((e) => e == null) || next.some((e) => e == null)) return false;
    const prevRows = prev.flatMap((e) => (e ? [e] : []));
    const nextRows = next.flatMap((e) => (e ? [e] : []));
    const prevIds = prevRows.map(eventId);
    const nextIds = nextRows.map(eventId);
    if (prevIds.some((id) => id == null) || nextIds.some((id) => id == null)) return false;
    if (new Set(nextIds).size !== nextIds.length) return false;
    const prevById = new Map(prevRows.map((e) => [eventId(e), e]));
    if (
        prevRows.some((row) => {
            const id = eventId(row);
            if (!id || nextIds.includes(id)) return false;
            return UNDELETABLE_RECORD_EVENTS.has(String(row.type));
        })
    ) {
        return false;
    }

    const strip = (e: Record<string, unknown>) => {
        const { time_sec: _t, temp_c: _c, ...rest } = e;
        if (e.type === 'Note') {
            const { note: _n, gas: _g, airflow: _a, drum: _d, ...kept } = rest;
            return kept;
        }
        if (e.type === 'Heater') {
            const { note: _n, ...kept } = rest;
            return kept;
        }
        return rest;
    };
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const timeOk = (time: unknown) => typeof time === 'number' && time >= 0 && time <= 5999;
    const tempOk = (row: Record<string, unknown>) => {
        if (!('temp_c' in row) || row.temp_c == null) return true;
        return typeof row.temp_c === 'number' && row.temp_c >= 0 && row.temp_c <= 400;
    };
    const touched = new Set<string>();
    const addedTypes: string[] = [];

    for (const row of nextRows) {
        const id = eventId(row);
        if (!id) return false;
        const time = row.time_sec;
        const temp = row.temp_c;
        if (typeof time !== 'number' || time < 0) return false;
        if ('temp_c' in row && temp != null && typeof temp !== 'number') return false;
        const old = prevById.get(id);
        if (old) {
            if (old.type === 'Note') {
                if ('note' in row && row.note != null && typeof row.note !== 'string') return false;
                if (['gas', 'airflow', 'drum'].some((key) => key in row && typeof row[key] !== 'string')) return false;
            }
            if (old.type === 'Heater' && 'note' in row && (typeof row.note !== 'string' || row.note.length === 0))
                return false;
            if (!same(strip(row), strip(old))) return false;
            if (old.type === 'Charge' && time !== old.time_sec && time !== 0) return false;
            if (time !== old.time_sec) touched.add(id);
            const tempMoved = 'temp_c' in row && temp !== old.temp_c;
            if (tempMoved && typeof temp === 'number' && (temp < 0 || temp > 400)) return false;
        } else if (row.type === 'Note') {
            const controlKeys = ['gas', 'airflow', 'drum'] as const;
            if (
                Object.keys(row).some(
                    (key) => !['id', 'type', 'time_sec', 'temp_c', 'note', ...controlKeys].includes(key),
                )
            )
                return false;
            if (controlKeys.some((key) => key in row && typeof row[key] !== 'string')) return false;
            const hasControl = controlKeys.some((key) => typeof row[key] === 'string');
            const noteOk = typeof row.note === 'string' || (row.note == null && hasControl);
            if (!noteOk || !timeOk(time) || !tempOk(row)) return false;
            touched.add(id);
        } else if (typeof row.type === 'string' && ADDABLE_RECORD_EVENTS.has(row.type)) {
            if (Object.keys(row).some((key) => !['id', 'type', 'time_sec', 'temp_c'].includes(key))) return false;
            if (!timeOk(time) || !tempOk(row)) return false;
            if (prevRows.some((existing) => existing.type === row.type)) return false;
            addedTypes.push(row.type);
            touched.add(id);
        } else if (
            typeof row.type === 'string' &&
            row.type.length > 0 &&
            row.type.length <= 16 &&
            !CLOSED_RECORD_EVENTS.has(row.type)
        ) {
            if (Object.keys(row).some((key) => !['id', 'type', 'time_sec', 'temp_c'].includes(key))) return false;
            if (!timeOk(time) || !tempOk(row)) return false;
            touched.add(id);
        } else {
            return false;
        }
    }
    if (new Set(addedTypes).size !== addedTypes.length) return false;

    const marks = nextRows.flatMap((row) => {
        const id = eventId(row);
        const rank = typeof row.type === 'string' ? RECORD_EVENT_RANK[row.type] : undefined;
        if (!id || rank == null || typeof row.time_sec !== 'number') return [];
        return [{ rank, t: row.time_sec, touched: touched.has(id) }];
    });
    for (const a of marks) {
        for (const b of marks) {
            if (a.rank < b.rank && a.t > b.t && (a.touched || b.touched)) return false;
        }
    }
    return true;
};

export class MockDb {
    beans: BeanRow[] = [];
    stockEvents: BeanStockEvent[] = [];
    sessions: RoastSession[] = [];
    planBatches: PlanBatch[] = [];
    dayPlans: { id: string; user_id: string; plan_date: string }[] = [];
    roastedEvents: { id: string; reference_id: string | null; delta_grams: number; event_type: string }[] = [];
    /** R2 object key → TSV body served by the mocked get-download-url. */
    tsvFiles = new Map<string, string>();
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
        this.tsvFiles.clear();
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
        const sessionId = typeof params.session.id === 'string' ? params.session.id : uuid();
        const existing = this.sessions.find((session) => session.id === sessionId);
        if (existing) return existing;
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

    seedCompletedSession(partial: Partial<RoastSession>): RoastSession {
        const row: RoastSession = {
            id: uuid(),
            user_id: E2E_USER.id,
            weight_grams: 1000,
            output_weight_grams: null,
            status: 'completed',
            roasted_at: nowIso(),
            duration_seconds: null,
            drop_temp_celsius: null,
            roast_level: 'Medium',
            scheduled_at: null,
            notes: null,
            ambient_temp_celsius: null,
            ambient_humidity_pct: null,
            bean_id: null,
            profile_id: null,
            tsv_path: null,
            bbp_tsv_path: null,
            bbp_seconds: null,
            charge_temp_celsius: null,
            plan_batch_id: null,
            machine_id: null,
            machine_name: null,
            machine_roaster_key: null,
            machine_brand: null,
            machine_protocol: null,
            events: [],
            heater_events: null,
            created_at: nowIso(),
            updated_at: nowIso(),
            beans: null,
            roast_profiles: null,
            ...partial,
        };
        this.sessions.unshift(row);
        return row;
    }

    /** Mirrors update_roast_session_record: CAS on events/heater_events; time/temp edits plus missing FC marks. */
    updateRoastRecord(body: Record<string, unknown>): { status: number; body: unknown } {
        const s = this.sessions.find((x) => x.id === body.p_session_id);
        if (!s) return { status: 404, body: { code: 'PT404', message: 'roast_record_not_found' } };
        const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
        if (!same(s.events, body.p_expected_events) || !same(s.heater_events, body.p_expected_heater_events)) {
            return { status: 409, body: { code: 'PT409', message: 'roast_record_conflict' } };
        }
        if (!recordEventsEditOk(s.events, body.p_events)) {
            return { status: 422, body: { code: 'PT422', message: 'roast_record_invalid_events' } };
        }
        s.events = body.p_events;
        s.heater_events = body.p_heater_events ?? null;
        s.drop_temp_celsius = (body.p_drop_temp_celsius as number | null) ?? null;
        s.duration_seconds = (body.p_duration_seconds as number | null) ?? null;
        s.updated_at = nowIso();
        return { status: 200, body: s };
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
