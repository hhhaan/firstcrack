import type { ControlData } from '@features/active-roast/lib/chart-option';
import { feedbackValue } from '@shared/lib/feedback';
import type { TemperatureProcessing } from '@shared/types/sidecar';

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
    changes?: ControlData['changes'];
    points: {
        processing?: TemperatureProcessing;
        t: number;
        heater: number | null;
        fan: number | null;
        drum: number | null;
    }[];
    heatSet: (number | null)[];
    heatSetUnit?: string;
    referenceControls: boolean;
    displayedTarget: {
        readUnits?: ControlData['readUnits'];
        xs: number[];
        drum: (number | null)[];
        heater: (number | null)[];
        fan: (number | null)[];
    };
}): { hasControls: boolean; controlData: ControlData | undefined } => {
    const sessionHasControls = input.points.some((point) =>
        (['heater', 'fan', 'drum'] as const).some(
            (role) => feedbackValue(point[role], role, point.processing?.read_units) != null,
        ),
    );
    const hasControls = sessionHasControls || input.referenceControls;
    const hasRecordedCommands =
        input.changes?.some((change) =>
            Object.values(change.values).some((value) => value != null && Number.isFinite(value)),
        ) || input.heatSet.some((value) => value != null && Number.isFinite(value));
    if (!hasControls && !hasRecordedCommands) return { hasControls, controlData: undefined };
    return {
        hasControls,
        controlData: {
            changes: input.changes,
            readUnits: input.points.map((point) => point.processing?.read_units),
            xs: input.points.map((point) => point.t),
            drumTemp: input.points.map((point) => feedbackValue(point.drum, 'drum', point.processing?.read_units)),
            heatPower: input.points.map((point) => feedbackValue(point.heater, 'heater', point.processing?.read_units)),
            fanSpeed: input.points.map((point) => feedbackValue(point.fan, 'fan', point.processing?.read_units)),
            heatSet: input.heatSet,
            heatSetUnit: input.heatSetUnit,
            reference: input.referenceControls
                ? {
                      readUnits: input.displayedTarget.readUnits,
                      xs: input.displayedTarget.xs,
                      drum: input.displayedTarget.drum,
                      heater: input.displayedTarget.heater,
                      fan: input.displayedTarget.fan,
                  }
                : undefined,
        },
    };
};

/** Preserve the historical PDF fit independently of saved screen display settings. */
type CurveSample = { bt?: number | null; et?: number | null; ror?: number | null };

const finiteNumbers = (values: readonly (number | null | undefined)[]): number[] =>
    values.filter((value): value is number => value != null && Number.isFinite(value));

export const historyPrintTempBounds = (
    actual: readonly CurveSample[],
    target: readonly CurveSample[],
    includeTarget: { bt: boolean; et: boolean } | null,
    fallbackMin: number,
    fallbackMax: number,
): { tempMinC: number; tempMaxC: number } => {
    const sampled = [
        ...actual.flatMap((point) => [point.bt, point.et]),
        ...(includeTarget
            ? target.flatMap((point) => [includeTarget.bt ? point.bt : null, includeTarget.et ? point.et : null])
            : []),
    ];
    const temperatures = finiteNumbers(sampled);
    const tempLow = temperatures.length ? Math.min(...temperatures) : fallbackMin;
    const tempHigh = temperatures.length ? Math.max(...temperatures) : fallbackMax;
    const tempMid = (tempLow + tempHigh) / 2;
    const tempSpan = Math.max(40, tempHigh - tempLow + 20);
    return {
        tempMinC: Math.floor((tempMid - tempSpan / 2) / 10) * 10,
        tempMaxC: Math.ceil((tempMid + tempSpan / 2) / 10) * 10,
    };
};
