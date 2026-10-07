import { controlAxisLayoutFor } from '@features/active-roast/lib/chart-option';
import type { ControlData } from '@features/active-roast/lib/chart-option/types';
import {
    type ControlChannel,
    type ControlUnits,
    DEFAULT_CONTROL_UNITS,
} from '@features/active-roast/lib/control-channels';
import {
    buildControlLiveReadout,
    buildControlReadoutGroups,
    type ControlLiveInput,
    stepValueAt,
} from '@features/active-roast/lib/control-readout';
import { supportedChannelVisible } from '@features/active-roast/lib/supported-control-channels';
import { useControlReadoutNowMs } from '@features/active-roast/lib/useControlReadoutNowMs';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { ControlReadoutStrip } from './ControlReadoutStrip';

export type ControlLiveReadoutInput = Omit<ControlLiveInput, 'nowMs'>;

export const ControlReadoutFromLive = ({
    style,
    live,
    chartReadoutActive,
    controlData,
    controlUnits,
    controlYMin,
    controlYMax,
    currentTimeSec,
    showTargetCurve,
    showControlDrum,
    showControlHeat,
    showControlFan,
    showProfileDrum,
    showProfileHeat,
    showProfileFan,
    supportedControls,
}: {
    style: CSSProperties;
    live?: ControlLiveReadoutInput;
    chartReadoutActive: boolean;
    controlData: ControlData | undefined;
    controlUnits: ControlUnits | undefined;
    controlYMin: number;
    controlYMax: number;
    currentTimeSec: number;
    showTargetCurve: boolean;
    showControlDrum: boolean;
    showControlHeat: boolean;
    showControlFan: boolean;
    showProfileDrum: boolean;
    showProfileHeat: boolean;
    showProfileFan: boolean;
    supportedControls?: Record<ControlChannel, boolean>;
}) => {
    const nowMs = useControlReadoutNowMs({
        connected: live?.connected ?? false,
        isActive: chartReadoutActive,
        lastValidReceivedAtMs: live?.lastValidReceivedAtMs,
        pollIntervalMs: live?.pollIntervalMs ?? 1000,
    });
    const groups = useMemo(() => {
        if (!controlData) return null;
        const shown = {
            drum: supportedChannelVisible('drum', showControlDrum, supportedControls),
            heat: supportedChannelVisible('heat', showControlHeat, supportedControls),
            fan: supportedChannelVisible('fan', showControlFan, supportedControls),
        };
        if (!shown.drum && !shown.heat && !shown.fan) return null;
        const axes = controlAxisLayoutFor({
            controlData,
            controlUnits,
            controlYMin,
            controlYMax,
            showTargetCurve,
            showControlDrum,
            showControlHeat,
            showControlFan,
            showProfileDrum,
            showProfileHeat,
            showProfileFan,
            supportedControls,
        });
        const readout = live ? buildControlLiveReadout({ ...live, nowMs }) : undefined;
        return buildControlReadoutGroups({
            shown,
            axes,
            units: controlUnits ?? DEFAULT_CONTROL_UNITS,
            live: readout,
            hasHeatSet: !!controlData.heatSet?.some((value) => value != null),
            heatTargetNow: controlData.heatTarget?.xs.length
                ? stepValueAt(controlData.heatTarget, currentTimeSec)
                : undefined,
        });
    }, [
        controlData,
        controlUnits,
        live,
        nowMs,
        controlYMin,
        controlYMax,
        currentTimeSec,
        showTargetCurve,
        showControlDrum,
        showControlHeat,
        showControlFan,
        showProfileDrum,
        showProfileHeat,
        showProfileFan,
        supportedControls,
    ]);
    if (!groups) return null;
    return <ControlReadoutStrip groups={groups} style={style} />;
};
