import { Frequency, type Options, RRule } from 'rrule';
import { UI_PREVIEW_DAYS } from './stock-calc';

/**
 * Recurrence interval types mapped to RFC 5545 FREQ values.
 */
export type RecurrenceInterval = 'daily' | 'weekly' | 'biweekly' | 'monthly';

/**
 * Map RecurrenceInterval to RRule Frequency.
 */
const intervalToFreq: Record<RecurrenceInterval, Frequency> = {
    daily: Frequency.DAILY,
    weekly: Frequency.WEEKLY,
    biweekly: Frequency.WEEKLY,
    monthly: Frequency.MONTHLY,
};

/**
 * Build an RFC 5545 RRULE string from simplified UI parameters.
 *
 * @param interval - The recurrence interval (daily, weekly, biweekly, monthly)
 * @param options - Optional: until date or count limit
 * @returns RFC 5545 RRULE string
 */
export function buildRRule(interval: RecurrenceInterval, options?: { until?: Date; count?: number }): string {
    const rruleOptions: Partial<RRuleOptions> = {
        freq: intervalToFreq[interval],
    };

    if (interval === 'biweekly') {
        rruleOptions.interval = 2;
    }

    if (options?.count && options.count > 0) {
        rruleOptions.count = options.count;
    } else if (options?.until) {
        // UNTIL in RRULE is exclusive — set to end of day for inclusive behavior
        const until = new Date(options.until);
        until.setHours(23, 59, 59, 999);
        rruleOptions.until = until;
    }

    // Convert to RFC 5545 string via RRule helper
    // optionsToString returns "RULE:FREQ=..." — strip the "RULE:" prefix
    return RRule.optionsToString(rruleOptions as RRuleOptions).replace(/^RULE:/, '');
}

/**
 * Expand an RFC 5545 RRULE string into an array of Date occurrences.
 *
 * @param rruleStr - RFC 5545 RRULE string (e.g. "FREQ=WEEKLY;INTERVAL=2;COUNT=4")
 * @param dtstart - The start date to anchor the recurrence
 * @returns Array of Date objects in local time, normalized to 00:00:00
 */
export function expandRRule(rruleStr: string, dtstart: Date): Date[] {
    const dtstartLocal = new Date(dtstart);
    dtstartLocal.setHours(0, 0, 0, 0);

    const rule = rruleWithDtstart(rruleStr, dtstartLocal);
    const allDates = rule
        .between(
            dtstartLocal,
            new Date(dtstartLocal.getTime() + UI_PREVIEW_DAYS * 24 * 60 * 60 * 1000),
            true, // inclusive
        )
        .map((d) => {
            // Normalize to local midnight
            const local = new Date(d);
            local.setHours(0, 0, 0, 0);
            return local;
        });

    // Deduplicate by date string
    const seen = new Set<string>();
    return allDates.filter((d) => {
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Expand an RRULE string for dates within a specific range.
 * This is the rendering-time variant — used instead of expanding everything at creation.
 *
 * @param rruleStr - RFC 5545 RRULE string
 * @param dtstart - Recurrence start date
 * @param rangeStart - Range lower bound (inclusive)
 * @param rangeEnd - Range upper bound (inclusive)
 * @returns Array of Date objects within the range
 */
export function expandRRuleInRange(rruleStr: string, dtstart: Date, rangeStart: Date, rangeEnd: Date): Date[] {
    const dtstartLocal = new Date(dtstart);
    dtstartLocal.setHours(0, 0, 0, 0);

    // Clamp rangeStart to dtstart (no point expanding before the rule starts)
    const from = dtstartLocal > rangeStart ? dtstartLocal : new Date(rangeStart);
    from.setHours(0, 0, 0, 0);

    const to = new Date(rangeEnd);
    to.setHours(23, 59, 59, 999);

    const rule = rruleWithDtstart(rruleStr, dtstartLocal);
    return rule.between(from, to, true).map((d) => {
        const local = new Date(d);
        local.setHours(0, 0, 0, 0);
        return local;
    });
}

/**
 * Exception row from roast_plan_batches for a recurring rule.
 */
export interface RecurrenceException {
    original_date: string; // The original recurrence date (ISO date string)
    scheduled_date: string; // Actual date (may differ from original if moved)
    exception_type: 'modified' | 'cancelled';
    // Overrides: if 'modified', these fields replace the master's values
    batch_size_kg?: number;
    target_roasted_kg?: number;
    bean_id?: string | null;
    bean_name?: string;
    machine_id?: string | null;
    roast_profile_id?: string | null;
    notes?: string;
    status?: string;
    [key: string]: unknown;
}

/**
 * Merged recurrence instance — combines master rule data with any exception overrides.
 */
export interface RecurrenceInstance {
    date: string; // ISO date string (yyyy-MM-dd)
    originalDate: string; // The original recurrence date
    exceptionType: 'normal' | 'modified' | 'cancelled';
    exception?: RecurrenceException; // Only present if modified or cancelled
}

/**
 * Merge expanded recurrence dates with exception rows.
 * - cancelled → excluded from result
 * - modified → instance data is overridden by the exception row
 * - no exception → normal instance
 *
 * @param expandedDates - Array of Date objects from expandRRule / expandRRuleInRange
 * @param exceptions - Array of exception rows from DB
 * @returns Merged instances (cancelled ones filtered out)
 */
export function mergeRecurrenceExceptions(
    expandedDates: Date[],
    exceptions: RecurrenceException[],
): RecurrenceInstance[] {
    // Build exception map keyed by original_date
    const exceptionMap = new Map<string, RecurrenceException>();
    for (const ex of exceptions) {
        exceptionMap.set(ex.original_date, ex);
    }

    const result: RecurrenceInstance[] = [];

    for (const date of expandedDates) {
        const dateStr = formatDateLocal(date);
        const ex = exceptionMap.get(dateStr);

        if (ex?.exception_type === 'cancelled') {
            // Skip cancelled instances
            continue;
        }

        result.push({
            date: dateStr,
            originalDate: dateStr,
            exceptionType: ex?.exception_type === 'modified' ? 'modified' : 'normal',
            exception: ex?.exception_type === 'modified' ? ex : undefined,
        });
    }

    // Also include exceptions whose original_date falls outside the expanded range
    // but has a scheduled_date that's been moved to a different date
    for (const ex of exceptions) {
        if (ex.exception_type === 'modified') {
            const matched = result.find((r) => r.originalDate === ex.original_date);
            if (!matched) {
                // This is a moved instance — include it with the scheduled_date
                result.push({
                    date: ex.scheduled_date,
                    originalDate: ex.original_date,
                    exceptionType: 'modified',
                    exception: ex,
                });
            }
        }
    }

    // Sort by date
    result.sort((a, b) => a.date.localeCompare(b.date));

    return result;
}

/**
 * Format a Date to yyyy-MM-dd in local timezone.
 */
export function formatDateLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Preview recurrence: return a human-readable list of dates
 * based on the given interval and dtstart.
 */
export function previewRecurrenceDates(interval: RecurrenceInterval | null, dtstart: Date, limit: number = 5): Date[] {
    if (!interval) return [];
    const rruleStr = buildRRule(interval, { count: limit });
    return expandRRule(rruleStr, dtstart).slice(0, limit);
}

// ── Internal types ────────────────────────────────────────────────────────────

const rruleWithDtstart = (rruleStr: string, dtstart: Date): RRule => {
    const parsed = RRule.parseString(rruleStr) as Partial<Options>;
    return new RRule({ ...parsed, dtstart });
};

interface RRuleOptions {
    freq: Frequency;
    interval: number;
    count: number;
    until: Date;
    dtstart: Date;
}
