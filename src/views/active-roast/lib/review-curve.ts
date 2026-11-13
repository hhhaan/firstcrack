import { logEntryTimeSec } from '@features/active-roast/lib/serialize-roast-events';
import type { LogEntry } from '@shared/types/roast';

/**
 * Samples a saved-curve review draws. A roast that ended at Drop is drawn to that mark,
 * the same as History, so a Drop moved earlier on the saved record ends the review curve too.
 * The snapshot keeps every sample. Returns the same array when nothing is cut.
 */
export const reviewPointsThroughDrop = <T extends { time: number }>(points: T[], entries: LogEntry[] | null): T[] => {
    if (!entries || entries.some((entry) => entry.event === 'End')) return points;
    const drop = entries.find((entry) => entry.event === 'Drop');
    const end = drop ? logEntryTimeSec(drop) : null;
    if (end == null || !points.some((point) => point.time > end)) return points;
    return points.filter((point) => !(point.time > end));
};
