import type { StoredBbpEvent } from '@shared/types/roast';
import { z } from 'zod';

const schema = z.object({
    carried: z.boolean().optional(),
    id: z.string().min(1).max(200),
    t: z.number().finite().nonnegative(),
    event: z.string().min(1).max(100),
    tempC: z.number().finite().nullable(),
    note: z.string().max(4096),
    gas: z.string().max(120).optional(),
    airflow: z.string().max(120).optional(),
    drum: z.string().max(120).optional(),
});

export const BBP_EVENTS_PREFIX = '# bbp_events\t';
export const parseBbpEvents = (raw: unknown): StoredBbpEvent[] => {
    if (!Array.isArray(raw)) return [];
    return raw.slice(-512).flatMap((value) => {
        const parsed = schema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
    });
};

/** A comment keeps older TSV readers compatible and avoids mixing phase time axes. */
export const bbpEventsMetadata = (events: readonly StoredBbpEvent[]): string =>
    events.length ? `${BBP_EVENTS_PREFIX}${JSON.stringify(events)}\n` : '';
