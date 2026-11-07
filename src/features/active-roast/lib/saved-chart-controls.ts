import { feedbackValue } from '@shared/lib/feedback';
import type { TemperatureProcessing } from '@shared/types/sidecar';
import type { ControlData } from './chart-option';

export const savedChartControls = (input: {
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
        input.changes?.some((change) => Object.values(change.values).some((value) => Number.isFinite(value))) ||
        input.heatSet.some((value) => value != null && Number.isFinite(value));
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
