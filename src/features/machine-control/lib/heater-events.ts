import type { Json } from '@shared/types/database.types';
import { extractReplayEvents, MAX_EVENTS, type ReplayEvent, type ReplayPlan, type ReplayPoint } from './replay';

const TIME_RE = /^(\d{1,3}):([0-5]?\d|60)$/;

export type ReplayPlanSource = 'batch' | 'profile' | 'tsv';

export type HeaterBounds = {
    min: number;
    max: number;
    /** 있으면 이 간격의 배수만 허용. 없으면 min/max만. 0–100 고정 아님. */
    step?: number;
};

export const parseEditTime = (value: string): number | null => {
    const trimmed = value.trim();
    const match = TIME_RE.exec(trimmed);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
};

export const formatEditTime = (sec: number): string => {
    const t = Math.max(0, Math.round(sec));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

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

export const heaterFitsBounds = (heater: number, bounds: HeaterBounds): boolean => {
    if (!Number.isFinite(heater)) return false;
    if (heater < bounds.min || heater > bounds.max) return false;
    if (bounds.step != null && bounds.step > 0) {
        const n = (heater - bounds.min) / bounds.step;
        if (Math.abs(n - Math.round(n)) > 1e-6) return false;
    }
    return true;
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

/** 프로파일의 저장된 지시를 우선해 차트용 화력 목표 계단선을 만든다. */
export const profileHeatTarget = (points: ReplayPoint[], dropTime: number | null, profileEvents: unknown) => {
    const events =
        profileEvents == null ? extractReplayEvents(points, dropTime)?.events : parseHeaterEvents(profileEvents);
    const end = dropTime ?? points[points.length - 1]?.t;
    const steps = events?.filter((event) => end != null && event.t < end).sort((a, b) => a.t - b.t);
    if (!steps?.length || end == null) return undefined;
    return {
        xs: [...steps.map((event) => event.t), end],
        values: [...steps.map((event) => event.heater), steps[steps.length - 1].heater],
    };
};

export const heaterEventsToJson = (events: ReplayEvent[]): Json =>
    events.map((e) =>
        e.trigger ? { t: e.t, bt: e.bt, heater: e.heater, trigger: e.trigger } : { t: e.t, bt: e.bt, heater: e.heater },
    );

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

/** 정렬·상한·기기 범위. 빈 배열/과다/양수 화력 없음/범위 밖 → null. */
export const normalizeHeaterPlan = (
    events: ReplayEvent[],
    tpTime: number,
    bounds?: HeaterBounds,
): ReplayPlan | null => {
    if (events.length === 0 || events.length > MAX_EVENTS) return null;
    if (!events.some((e) => e.heater > 0)) return null;
    if (bounds && events.some((e) => !heaterFitsBounds(e.heater, bounds))) return null;
    const sorted = [...events].sort((a, b) => a.t - b.t || a.bt - b.bt);
    return { events: sorted, tpTime };
};

/**
 * 배치 > 프로파일 > TSV(Heat set).
 * 배치/프로파일 값이 있는데 파싱·검증 실패면 TSV로 조용히 대체하지 않는다.
 * profileEvents === null/undefined 만 TSV로 내려간다 (원본 복원).
 * step은 기기 값이 있을 때만. % UI 간격으로 만들지 않는다.
 */
export const resolveReplayPlan = ({
    points,
    dropTime,
    profileEvents,
    batchEvents,
    heaterMin,
    heaterMax,
    heaterStep,
}: {
    points: ReplayPoint[] | null | undefined;
    dropTime?: number | null;
    profileEvents?: unknown;
    batchEvents?: ReplayEvent[] | null;
    heaterMin?: number;
    heaterMax?: number;
    heaterStep?: number;
}): { plan: ReplayPlan | null; source: ReplayPlanSource | null; overrideInvalid: boolean } => {
    const extracted = points && points.length > 0 ? extractReplayEvents(points, dropTime) : null;
    const tpTime = extracted?.tpTime ?? Number.POSITIVE_INFINITY;
    const bounds = resolveHeaterBounds({ min: heaterMin, max: heaterMax, step: heaterStep });

    const inRangeTsv = extracted?.events.every((e) => heaterFitsBounds(e.heater, bounds)) ? extracted : null;

    if (batchEvents != null) {
        const batchPlan = normalizeHeaterPlan(batchEvents, tpTime, bounds);
        if (batchPlan) return { plan: batchPlan, source: 'batch', overrideInvalid: false };
        return { plan: null, source: 'batch', overrideInvalid: true };
    }
    if (profileEvents !== undefined && profileEvents !== null) {
        const parsedProfile = parseHeaterEvents(profileEvents);
        const profilePlan = parsedProfile ? normalizeHeaterPlan(parsedProfile, tpTime, bounds) : null;
        if (profilePlan) return { plan: profilePlan, source: 'profile', overrideInvalid: false };
        return { plan: null, source: 'profile', overrideInvalid: true };
    }
    if (inRangeTsv) return { plan: inRangeTsv, source: 'tsv', overrideInvalid: false };
    return { plan: null, source: inRangeTsv === null && extracted != null ? 'tsv' : null, overrideInvalid: false };
};
