import { isSameMonth, startOfMonth } from 'date-fns';

/** Months before the current one the dashboard header can open. */
export const DASHBOARD_MONTH_LOOKBACK = 24;

const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();

/** Negative when `month` is before `now`. */
export const dashboardMonthOffset = (month: Date, now = new Date()): number =>
    monthIndex(startOfMonth(month)) - monthIndex(startOfMonth(now));

export const canGoToPreviousDashboardMonth = (month: Date, now = new Date()) =>
    dashboardMonthOffset(month, now) > -DASHBOARD_MONTH_LOOKBACK;

export const canGoToNextDashboardMonth = (month: Date, now = new Date()) => !isSameMonth(month, now);
