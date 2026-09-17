import { format, isValid, parseISO } from 'date-fns';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isUuid = (id: string): boolean => UUID_RE.test(id);

const isCanonicalDate = (date: string): boolean => {
    if (!DATE_RE.test(date)) return false;
    const parsed = parseISO(`${date}T00:00:00`);
    return isValid(parsed) && format(parsed, 'yyyy-MM-dd') === date;
};

/** Canonical virtual occurrence id: `{ruleUuid}:{yyyy-MM-dd}` with a real calendar date. */
export const parseVirtualPlanBatchId = (id: string): { ruleId: string; originalDate: string } | null => {
    const parts = id.split(':');
    if (parts.length !== 2) return null;
    const [ruleId, originalDate] = parts;
    if (!isUuid(ruleId) || !isCanonicalDate(originalDate)) return null;
    return { ruleId, originalDate };
};
