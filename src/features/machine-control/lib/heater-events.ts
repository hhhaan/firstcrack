import { parseEditTime } from '@shared/lib/time-edit';
import type { Json } from '@shared/types/database.types';
import type { StoredRoastEvent } from '@shared/types/roast';
import {
    extractReplayEvents,
    MAX_EVENTS,
    type ReplayEvent,
    type ReplayPlan,
    type ReplayPoint,
    type ReplayTrigger,
    resolveReferenceTpTime,
} from './replay';

export {
    applyTimeEdit,
    commitEditTime,
    isPartialTime,
    parseEditTime,
    type TimeEdit,
    type TimeEditKind,
} from '@shared/lib/time-edit';

/** 입력 중 숫자. 숫자·점 하나·소수 `decimals`자리까지, 음수 허용 시에만 선행 `-`. */
export const isDecimalDraft = (value: string, decimals: number, negative = false): boolean =>
    new RegExp(`^${negative ? '-?' : ''}\\d*(\\.\\d{0,${decimals}})?$`).test(value);

/** `session` = History-edited record plan (roast_sessions.heater_events). */
export type ReplayPlanSource = 'batch' | 'profile' | 'session' | 'tsv';

export type HeaterBounds = {
    min: number;
    max: number;
    /** 있으면 이 간격의 배수만 허용. 없으면 min/max만. 0–100 고정 아님. */
    step?: number;
};

export const formatEditTime = (sec: number): string => {
    const t = Math.max(0, Math.round(sec));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** BT is shown at 0.1°. Heater keeps two places for fractional units (kPa, 0.5 steps). */
export const BT_DECIMALS = 1;
export const HEAT_DECIMALS = 2;

export const toDisplayBt = (c: number, unit: 'C' | 'F') => (unit === 'F' ? (c * 9) / 5 + 32 : c);
export const fromDisplayBt = (v: number, unit: 'C' | 'F') => (unit === 'F' ? ((v - 32) * 5) / 9 : v);

/** 빈 문자열·공백·NaN·Infinity 거부. Number('')===0 함정 차단. */
export const parseFiniteNumber = (value: unknown): number | null => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return null;
        value = trimmed;
    }
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(n) ? n : null;
};

const heaterOffStep = (heater: number, bounds: HeaterBounds): boolean => {
    if (bounds.step == null || bounds.step <= 0) return false;
    const n = (heater - bounds.min) / bounds.step;
    return Math.abs(n - Math.round(n)) > 1e-6;
};

export const heaterFitsBounds = (heater: number, bounds: HeaterBounds): boolean => {
    if (!Number.isFinite(heater)) return false;
    if (heater < bounds.min || heater > bounds.max) return false;
    return !heaterOffStep(heater, bounds);
};

export type HeaterDraftIssue =
    | { code: 'time' | 'bt' | 'heat-empty' | 'heat-range' | 'heat-step'; row: number }
    | { code: 'too-many' };

export type HeaterDraftInput = {
    t: string;
    bt: string;
    heater: string;
    trigger: ReplayTrigger;
    id?: string;
    /** Hidden reference coordinates must survive display rounding. */
    referenceT?: number;
    referenceBt?: number;
};

/** Parsed events that still violate the plan rules. Row numbers are 1-based. */
export const issueForHeaterEvents = (events: ReplayEvent[], bounds: HeaterBounds): HeaterDraftIssue | null => {
    if (events.length > MAX_EVENTS) return { code: 'too-many' };
    for (let i = 0; i < events.length; i++) {
        const heater = events[i].heater;
        if (!Number.isFinite(heater) || heater < bounds.min || heater > bounds.max) {
            return { code: 'heat-range', row: i + 1 };
        }
        if (heaterOffStep(heater, bounds)) return { code: 'heat-step', row: i + 1 };
    }
    return null;
};

/**
 * First failing row and field. An empty draft is valid and means "clear the plan".
 * Logical 0 is in range when `bounds.min` is 0. A 0 step is a gas cut even when the
 * plan never turned the burner on — the machine may already be firing.
 */
export const validateHeaterDraft = (
    rows: readonly HeaterDraftInput[],
    unit: 'C' | 'F',
    bounds: HeaterBounds,
): { ok: true; events: ReplayEvent[] } | { ok: false; issue: HeaterDraftIssue } => {
    const events: ReplayEvent[] = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNo = i + 1;
        const t = row.trigger === 'bt' && row.referenceT != null ? row.referenceT : parseEditTime(row.t);
        if (t == null || !Number.isFinite(t) || t < 0) return { ok: false, issue: { code: 'time', row: rowNo } };
        const btDisplay = parseFiniteNumber(row.bt);
        const bt =
            row.trigger === 'time' && row.referenceBt != null
                ? row.referenceBt
                : btDisplay == null
                  ? Number.NaN
                  : fromDisplayBt(btDisplay, unit);
        if (!Number.isFinite(bt)) return { ok: false, issue: { code: 'bt', row: rowNo } };
        const heater = parseFiniteNumber(row.heater);
        if (heater == null) return { ok: false, issue: { code: 'heat-empty', row: rowNo } };
        if (heater < bounds.min || heater > bounds.max) return { ok: false, issue: { code: 'heat-range', row: rowNo } };
        if (heaterOffStep(heater, bounds)) return { ok: false, issue: { code: 'heat-step', row: rowNo } };
        events.push({ t, bt, heater, trigger: row.trigger, ...(row.id ? { id: row.id } : {}) });
    }
    const issue = issueForHeaterEvents(events, bounds);
    return issue ? { ok: false, issue } : { ok: true, events };
};

const asFinite = parseFiniteNumber;

/** jsonb → 이벤트 배열. 형식이 아니면 null. TSV로 퇴화하지 않는다. */
export const parseHeaterEvents = (raw: unknown): ReplayEvent[] | null => {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const events: ReplayEvent[] = [];
    for (const row of raw) {
        if (!row || typeof row !== 'object') return null;
        const rec = row as Record<string, unknown>;
        const t = asFinite(rec.t);
        const bt = asFinite(rec.bt);
        const heater = asFinite(rec.heater);
        if (t == null || t < 0 || bt == null || heater == null) return null;
        const trigger = rec.trigger;
        if (trigger != null && trigger !== 'time' && trigger !== 'bt') return null;
        events.push(trigger === 'time' || trigger === 'bt' ? { t, bt, heater, trigger } : { t, bt, heater });
    }
    return events;
};

/** null = no profile plan; undefined = a directly selected record's own TSV commands. */
export const profileHeatTarget = (
    points: ReplayPoint[],
    dropTime: number | null,
    profileEvents: unknown,
    referenceTpTime?: number | null,
) => {
    const events =
        profileEvents === undefined
            ? extractReplayEvents(points, dropTime, referenceTpTime)?.events
            : parseHeaterEvents(profileEvents);
    const end = dropTime ?? points[points.length - 1]?.t;
    const steps = events?.filter((event) => end != null && event.t < end).sort((a, b) => a.t - b.t);
    if (!steps?.length || end == null) return undefined;
    return {
        xs: [...steps.map((event) => event.t), end],
        values: [...steps.map((event) => event.heater), steps[steps.length - 1].heater],
    };
};

/**
 * History-edited plan → Heat set per curve sample. Only [0, dropTime) is replaced;
 * BBP/cooldown samples keep the recorded value. null = no valid edit (draw the TSV as-is).
 */
export const editedHeatSet = (
    points: ReadonlyArray<{ t: number; heaterSet?: number | null }>,
    dropTime: number | null | undefined,
    heaterEvents: unknown,
): (number | null)[] | null => {
    const events = heaterEvents == null ? null : parseHeaterEvents(heaterEvents);
    if (!events) return null;
    const steps = [...events].sort((a, b) => a.t - b.t);
    const end = dropTime ?? Number.POSITIVE_INFINITY;
    return points.map((p) => {
        if (p.t < 0 || p.t >= end) return p.heaterSet ?? null;
        let value: number | null = null;
        for (const s of steps) if (s.t <= p.t) value = s.heater;
        return value ?? p.heaterSet ?? null;
    });
};

/** Edited roast plan replaces post-Charge Heater rows; BBP records stay as recorded. */
export const withEditedHeaterLog = (
    events: StoredRoastEvent[],
    heaterEvents: unknown,
    heaterUnit: string,
): StoredRoastEvent[] => {
    const plan = heaterEvents == null ? null : parseHeaterEvents(heaterEvents);
    if (!plan) return events;
    const rows: StoredRoastEvent[] = plan.map((e, i) => ({
        id: `heater-plan-${i}`,
        type: 'Heater',
        time_sec: e.t,
        temp_c: e.bt,
        note: `${e.heater}${heaterUnit}`,
    }));
    return [...events.filter((e) => e.type !== 'Heater' || e.time_sec < 0), ...rows].sort(
        (a, b) => a.time_sec - b.time_sec,
    );
};

export const heaterEventsToJson = (events: ReplayEvent[]): Json =>
    events.map((e) =>
        e.trigger ? { t: e.t, bt: e.bt, heater: e.heater, trigger: e.trigger } : { t: e.t, bt: e.bt, heater: e.heater },
    );

const heaterNoteNumber = (note: string): number | null => {
    const match = note.trim().match(/^\d+(?:\.\d+)?/);
    if (!match) return null;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : null;
};

/** Chart label `heater-plan-N` is the Nth stored heat step. Time and the label number can change. */
export const patchHeaterPlanMarker = (
    heaterEvents: unknown,
    logId: string,
    patch: { timeSec?: number; note?: string },
): Json | null => {
    const index = /^heater-plan-(\d+)$/.exec(logId);
    if (!index) return null;
    const plan = parseHeaterEvents(heaterEvents);
    if (!plan) return null;
    const at = Number(index[1]);
    const step = plan[at];
    if (!step) return null;
    const heater = patch.note == null ? step.heater : heaterNoteNumber(patch.note);
    if (heater == null) return null;
    const t = patch.timeSec != null && Number.isFinite(patch.timeSec) ? Math.max(0, Math.round(patch.timeSec)) : step.t;
    return heaterEventsToJson(plan.map((event, i) => (i === at ? { ...event, t, heater } : event)));
};

/** A recorded Heater row (BBP, or a log with no separate heat plan). */
export const patchStoredHeaterEvent = (
    raw: unknown,
    logId: string,
    patch: { timeSec?: number; note?: string },
): Json | null => {
    if (!Array.isArray(raw)) return null;
    let found = false;
    const next = raw.map((item) => {
        if (item == null || typeof item !== 'object' || Array.isArray(item)) return item;
        const row = item as Record<string, unknown>;
        if (row.id !== logId || row.type !== 'Heater') return item;
        found = true;
        const timeSec =
            patch.timeSec != null && Number.isFinite(patch.timeSec) ? Math.round(patch.timeSec) : row.time_sec;
        return { ...row, time_sec: timeSec, ...(patch.note != null ? { note: patch.note } : {}) };
    });
    return found ? (next as Json) : null;
};

const FALLBACK_HEATER_BOUNDS: HeaterBounds = { min: 0, max: 100 };

export const numericHeaterStep = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const finiteBound = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

type WriteMapHeater = { min?: unknown; max?: unknown; unit?: unknown; step?: unknown };

const writeMapHeater = (params: unknown): WriteMapHeater | undefined => {
    if (!params || typeof params !== 'object') return undefined;
    const writeMap = (params as { write_map?: unknown }).write_map;
    if (!writeMap || typeof writeMap !== 'object') return undefined;
    const heater = (writeMap as { heater?: unknown }).heater;
    if (!heater || typeof heater !== 'object') return undefined;
    return heater as WriteMapHeater;
};

/** Status limit / write_map heater. step only when the device actually has one. */
export const resolveHeaterBounds = (input?: {
    min?: number | null;
    max?: number | null;
    unit?: string | null;
    step?: number | null;
    params?: unknown;
}): HeaterBounds & { unit: string } => {
    const fromMap = writeMapHeater(input?.params);
    const step = numericHeaterStep(input?.step) ?? numericHeaterStep(fromMap?.step);
    return {
        min: finiteBound(input?.min ?? fromMap?.min, FALLBACK_HEATER_BOUNDS.min),
        max: finiteBound(input?.max ?? fromMap?.max, FALLBACK_HEATER_BOUNDS.max),
        unit:
            (typeof input?.unit === 'string' && input.unit) ||
            (typeof fromMap?.unit === 'string' && fromMap.unit) ||
            '%',
        ...(step != null ? { step } : {}),
    };
};

export type ProfileHeaterOrigin = 'live' | 'saved' | 'fallback';

export const liveHeaterFromStatus = (
    status:
        | {
              connected?: boolean;
              roaster?: string;
              control?: { limits?: { heater?: { min?: number; max?: number; unit?: string; step?: unknown } } };
          }
        | null
        | undefined,
): { roaster: string; heater: { min?: number; max?: number; unit?: string; step?: number } | null } | undefined => {
    if (!status?.connected || !status.roaster) return undefined;
    const heater = status.control?.limits?.heater;
    if (!heater) return { roaster: status.roaster, heater: null };
    return {
        roaster: status.roaster,
        heater: {
            min: heater.min,
            max: heater.max,
            unit: heater.unit,
            step: numericHeaterStep(heater.step),
        },
    };
};

export const profileHeaterBounds = (
    profile: { machine_id?: string | null; machine_roaster_key?: string | null } | null | undefined,
    machines: Array<{ id: string; roasterKey?: string; connectionParams: Record<string, unknown> }>,
    registry: Record<string, { default_params: Record<string, unknown> }>,
    live?: { roaster?: string | null; heater?: { min?: number; max?: number; unit?: string; step?: number } | null },
): HeaterBounds & { unit: string; origin: ProfileHeaterOrigin } => {
    const saved = profile?.machine_id ? machines.find((m) => m.id === profile.machine_id) : undefined;
    const key = saved?.roasterKey ?? profile?.machine_roaster_key ?? undefined;
    const params = saved?.connectionParams ?? (key ? registry[key]?.default_params : undefined);
    const liveMatches = Boolean(live?.roaster && (live.roaster === key || live.roaster === saved?.roasterKey));
    if (liveMatches && live?.heater) {
        return {
            ...resolveHeaterBounds({
                min: live.heater.min,
                max: live.heater.max,
                unit: live.heater.unit,
                step: live.heater.step,
            }),
            origin: 'live',
        };
    }
    const bounds = resolveHeaterBounds({ params });
    if (
        key &&
        [
            'giesen_standard',
            'giesen_w30a',
            'giesen_w30a_pro',
            'giesen_w15e',
            'giesen_w140a_v1',
            'giesen_w140a_v2',
            'giesen_w1',
            'giesen_sample',
            'giesen_w45a_w60a',
            'giesen_wxa',
            'giesen_wxa_plus',
            'giesen_wxa_coarse',
        ].includes(key)
    ) {
        const heater = writeMapHeater(params);
        // Offline registry omits write maps; match the frozen legacy default to preserve custom maps.
        const coarse = key === 'giesen_wxa_coarse';
        const legacy = {
            db: 2,
            offset: 14,
            area: 6,
            type: 0,
            div: 0,
            min: 1,
            max: coarse ? 10 : 100,
            unit: coarse ? 'step' : '%',
        };
        if (
            heater &&
            Object.keys(heater).length === Object.keys(legacy).length &&
            Object.entries(legacy).every(([field, value]) => (heater as Record<string, unknown>)[field] === value)
        ) {
            bounds.min = 0;
        }
    }
    return { ...bounds, origin: writeMapHeater(params) ? 'saved' : 'fallback' };
};

/** Keep explicit ids; otherwise inherit the previous slot so value edits stay the same row. */
export const carryReplayEventIds = (events: ReplayEvent[], prev?: ReplayEvent[] | null): ReplayEvent[] =>
    events.map((e, i) => ({ ...e, id: e.id ?? prev?.[i]?.id ?? `e${i}` }));

/**
 * Consumed rows are identified by id, not mutable t/heater.
 * Missing ids fall back to an acked prefix count so unlabeled edits do not re-run.
 */
export const remapReplayIndex = (oldEvents: ReplayEvent[], consumed: number, newEvents: ReplayEvent[]): number => {
    const limit = Math.max(0, Math.min(consumed, oldEvents.length));
    if (limit === 0) return 0;
    const oldIds = oldEvents.slice(0, limit).map((e) => e.id);
    if (oldIds.every((id) => id != null) && newEvents.some((e) => e.id != null)) {
        let j = 0;
        for (const id of oldIds) {
            let k = j;
            while (k < newEvents.length && newEvents[k].id !== id) k += 1;
            if (k < newEvents.length) j = k + 1;
        }
        return j;
    }
    return Math.min(limit, newEvents.length);
};

/** 정렬·상한·기기 범위. 빈 배열/과다/범위 밖 → null. 0만 있는 편집본도 끄기 명령으로 유지한다. */
export const normalizeHeaterPlan = (
    events: ReplayEvent[],
    tpTime: number,
    bounds?: HeaterBounds,
): ReplayPlan | null => {
    if (events.length === 0 || events.length > MAX_EVENTS) return null;
    if (bounds && events.some((e) => !heaterFitsBounds(e.heater, bounds))) return null;
    const sorted = [...events].sort((a, b) => a.t - b.t || a.bt - b.bt);
    return { events: sorted, tpTime };
};

/**
 * 배치 편집 > 선택한 기준의 자체 화력 계획.
 * null은 프로파일 계획 없음, undefined만 직접 선택한 기록의 TSV(Heat set)를 사용한다.
 * 파싱·검증 실패면 TSV로 조용히 대체하지 않는다.
 * step은 기기 값이 있을 때만. % UI 간격으로 만들지 않는다.
 */
export const resolveReplayPlan = ({
    points,
    dropTime,
    referenceTpTime,
    profileEvents,
    batchEvents,
    heaterMin,
    heaterMax,
    heaterStep,
}: {
    points: ReplayPoint[] | null | undefined;
    dropTime?: number | null;
    referenceTpTime?: number | null;
    profileEvents?: unknown;
    batchEvents?: ReplayEvent[] | null;
    heaterMin?: number;
    heaterMax?: number;
    heaterStep?: number;
}): { plan: ReplayPlan | null; source: ReplayPlanSource | null; overrideInvalid: boolean } => {
    const tpTime = resolveReferenceTpTime(points ?? [], dropTime, referenceTpTime);
    const extracted = points && points.length > 0 ? extractReplayEvents(points, dropTime, tpTime) : null;
    const bounds = resolveHeaterBounds({ min: heaterMin, max: heaterMax, step: heaterStep });

    const inRangeTsv = extracted?.events.every((e) => heaterFitsBounds(e.heater, bounds)) ? extracted : null;

    if (batchEvents != null) {
        const batchPlan = normalizeHeaterPlan(batchEvents, tpTime, bounds);
        if (batchPlan) return { plan: batchPlan, source: 'batch', overrideInvalid: false };
        return { plan: null, source: 'batch', overrideInvalid: true };
    }
    if (profileEvents === null) return { plan: null, source: null, overrideInvalid: false };
    if (profileEvents !== undefined) {
        const parsedProfile = parseHeaterEvents(profileEvents);
        const profilePlan = parsedProfile ? normalizeHeaterPlan(parsedProfile, tpTime, bounds) : null;
        if (profilePlan) return { plan: profilePlan, source: 'profile', overrideInvalid: false };
        return { plan: null, source: 'profile', overrideInvalid: true };
    }
    if (inRangeTsv) return { plan: inRangeTsv, source: 'tsv', overrideInvalid: false };
    return { plan: null, source: inRangeTsv === null && extracted != null ? 'tsv' : null, overrideInvalid: false };
};
