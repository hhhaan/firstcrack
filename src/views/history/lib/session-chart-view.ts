import type { ControlData } from '@features/active-roast/lib/chart-option';

/** Pure view decisions for a stored roast chart. Hooks stay on the component. */

export const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

export const historyTargetVisible = (enabled: boolean, pointCount: number): boolean => enabled && pointCount > 0;

export const profileForSession = <T extends { id: string; user_id: string }>(
    profiles: T[],
    session: { profile_id: string | null; user_id: string },
): T | null =>
    profiles.find((profile) => profile.id === session.profile_id && profile.user_id === session.user_id) ?? null;

export const curveStatusKey = (state: { isLoading: boolean; isError: boolean; empty: boolean }): string | null => {
    if (state.isLoading) return 'bbp.loading';
    if (state.isError) return 'bbp.failed';
    if (state.empty) return 'bbp.empty';
    return null;
};

export const roastChartStatusKey = (loading: boolean, failed: boolean): string | null => {
    if (loading) return 'history.expanded.chartLoading';
    if (failed) return 'history.expanded.chartUnavailable';
    return null;
};

export const referenceStatusKey = (
    name: string | null,
    loading: boolean,
    failed: boolean,
): { name: string; key: string } | null => {
    if (!name || (!loading && !failed)) return null;
    return { name, key: loading ? 'bbp.loading' : 'bbp.failed' };
};

export const mergedBbpRange = (
    actual: { start: number } | undefined,
    target: { start: number } | undefined,
): { start: number; end: number } | undefined =>
    actual || target ? { start: Math.min(actual?.start ?? 0, target?.start ?? 0), end: 0 } : undefined;

export const historyXView = (input: {
    bbpStart: number | undefined;
    durationSec: number | null;
    lastT: number | undefined;
    targetT: number | undefined;
}) => ({
    min: input.bbpStart ?? 0,
    max: Math.max(1, input.durationSec ?? 0, input.lastT ?? 0, input.targetT ?? 0),
});

export const historyControls = (input: {
    points: { t: number; heater: number | null; fan: number | null; drum: number | null }[];
    heatSet: (number | null)[];
    referenceControls: boolean;
    displayedTarget: {
        xs: number[];
        drum: (number | null)[];
        heater: (number | null)[];
        fan: (number | null)[];
    };
}): { hasControls: boolean; controlData: ControlData | undefined } => {
    const sessionHasControls = input.points.some(
        (point) => point.heater != null || point.fan != null || point.drum != null,
    );
    const hasControls = sessionHasControls || input.referenceControls;
    if (!hasControls) return { hasControls, controlData: undefined };
    return {
        hasControls,
        controlData: {
            xs: input.points.map((point) => point.t),
            drumTemp: input.points.map((point) => point.drum),
            heatPower: input.points.map((point) => point.heater),
            fanSpeed: input.points.map((point) => point.fan),
            heatSet: input.heatSet,
            reference: input.referenceControls
                ? {
                      xs: input.displayedTarget.xs,
                      drum: input.displayedTarget.drum,
                      heater: input.displayedTarget.heater,
                      fan: input.displayedTarget.fan,
                  }
                : undefined,
        },
    };
};
