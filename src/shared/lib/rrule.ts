import { RRule, Frequency } from 'rrule';

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
export function buildRRule(
    interval: RecurrenceInterval,
    options?: { until?: Date; count?: number },
): string {
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

    const rule = RRule.fromString(rruleStr);
    const allDates = rule.between(
        dtstartLocal,
        new Date(dtstartLocal.getTime() + 365 * 24 * 60 * 60 * 1000),
        true, // inclusive
    ).map((d) => {
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
 * Preview recurrence: return a human-readable list of dates
 * based on the given interval and dtstart.
 */
export function previewRecurrenceDates(
    interval: RecurrenceInterval | null,
    dtstart: Date,
    limit: number = 5,
): Date[] {
    if (!interval) return [];
    const rruleStr = buildRRule(interval, { count: limit });
    return expandRRule(rruleStr, dtstart).slice(0, limit);
}

// ── Internal types ────────────────────────────────────────────────────────────

interface RRuleOptions {
    freq: Frequency;
    interval: number;
    count: number;
    until: Date;
    dtstart: Date;
}
