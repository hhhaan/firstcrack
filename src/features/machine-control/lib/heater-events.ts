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

export const heaterEventsToJson = (events: ReplayEvent[]): Json =>
    events.map((e) =>
        e.trigger ? { t: e.t, bt: e.bt, heater: e.heater, trigger: e.trigger } : { t: e.t, bt: e.bt, heater: e.heater },
    );

export const sameReplayEvent = (a: ReplayEvent, b: ReplayEvent): boolean =>
    a.t === b.t && a.bt === b.bt && a.heater === b.heater && (a.trigger ?? '') === (b.trigger ?? '');

/**
 * 이미 실행한 이벤트(old[0..consumed))를 new에서 순서대로 부분수열 매칭.
 * 매칭된 새 행은 건너뛴다(재실행 없음). 삭제된 실행 행은 버림.
 * 실행 지점 앞에 끼워 넣은 행도 이미 지난 것으로 보고 건너뛴다.
 */
export const remapReplayIndex = (oldEvents: ReplayEvent[], consumed: number, newEvents: ReplayEvent[]): number => {
    let j = 0;
    const limit = Math.max(0, Math.min(consumed, oldEvents.length));
    for (let i = 0; i < limit; i++) {
        while (j < newEvents.length && !sameReplayEvent(oldEvents[i], newEvents[j])) j += 1;
        if (j < newEvents.length && sameReplayEvent(oldEvents[i], newEvents[j])) j += 1;
    }
    return j;
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

const defaultBounds = (heaterMin?: number, heaterMax?: number): HeaterBounds => ({
    min: heaterMin ?? 0,
    max: heaterMax ?? 100,
});

/**
 * 배치 > 프로파일 > TSV(Heat set).
 * 배치/프로파일 값이 있는데 파싱·검증 실패면 TSV로 조용히 대체하지 않는다.
 * profileEvents === null/undefined 만 TSV로 내려간다 (원본 복원).
 */
export const resolveReplayPlan = ({
    points,
    dropTime,
    profileEvents,
    batchEvents,
    heaterMin,
    heaterMax,
}: {
    points: ReplayPoint[] | null | undefined;
    dropTime?: number | null;
    profileEvents?: unknown;
    batchEvents?: ReplayEvent[] | null;
    heaterMin?: number;
    heaterMax?: number;
}): { plan: ReplayPlan | null; source: ReplayPlanSource | null; overrideInvalid: boolean } => {
    const extracted = points && points.length > 0 ? extractReplayEvents(points, dropTime) : null;
    const tpTime = extracted?.tpTime ?? Number.POSITIVE_INFINITY;
    const bounds = defaultBounds(heaterMin, heaterMax);

    const inRangeTsv =
        extracted != null && extracted.events.every((e) => heaterFitsBounds(e.heater, bounds)) ? extracted : null;

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
