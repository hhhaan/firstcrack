import type { Json } from '@shared/types/database.types';
import { extractReplayEvents, MAX_EVENTS, type ReplayEvent, type ReplayPlan, type ReplayPoint } from './replay';

const TIME_RE = /^(\d{1,3}):([0-5]?\d|60)$/;

export type ReplayPlanSource = 'batch' | 'profile' | 'tsv';

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

const asFinite = (value: unknown): number | null => {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(n) ? n : null;
};

/** jsonb → 이벤트 배열. 형식이 아니면 null (TSV 추출로 퇴화). */
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

/** 정렬·상한. 빈 배열/과다/양수 화력 없음 → null. */
export const normalizeHeaterPlan = (events: ReplayEvent[], tpTime: number): ReplayPlan | null => {
    if (events.length === 0 || events.length > MAX_EVENTS) return null;
    if (!events.some((e) => e.heater > 0)) return null;
    const sorted = [...events].sort((a, b) => a.t - b.t || a.bt - b.bt);
    return { events: sorted, tpTime };
};

export const resolveReplayPlan = ({
    points,
    dropTime,
    profileEvents,
    batchEvents,
}: {
    points: ReplayPoint[] | null | undefined;
    dropTime?: number | null;
    profileEvents?: unknown;
    batchEvents?: ReplayEvent[] | null;
}): { plan: ReplayPlan | null; source: ReplayPlanSource | null } => {
    const extracted = points && points.length > 0 ? extractReplayEvents(points, dropTime) : null;
    const tpTime = extracted?.tpTime ?? Number.POSITIVE_INFINITY;
    const batchPlan = batchEvents ? normalizeHeaterPlan(batchEvents, tpTime) : null;
    if (batchPlan) return { plan: batchPlan, source: 'batch' };
    const parsedProfile = parseHeaterEvents(profileEvents);
    const profilePlan = parsedProfile ? normalizeHeaterPlan(parsedProfile, tpTime) : null;
    if (profilePlan) return { plan: profilePlan, source: 'profile' };
    if (extracted) return { plan: extracted, source: 'tsv' };
    return { plan: null, source: null };
};
