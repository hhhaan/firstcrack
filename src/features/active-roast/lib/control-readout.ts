import {
    CONTROL_CHANNEL_LABEL,
    CONTROL_LEFT_AXIS,
    CONTROL_RIGHT_AXIS,
    type ControlAxisLayout,
    type ControlChannel,
    type ControlUnits,
    formatControlValue,
} from './control-channels';
import type { ObservationQuality } from './sensorObservation';
import type { SupportedControlChannelsInput } from './supported-control-channels';
import { resolveSupportedControlChannels } from './supported-control-channels';

/** live = this poll's reading. stale = sidecar is replaying its last good read. offline = no link. */
export type ControlLinkState = 'live' | 'stale' | 'offline';

export const CONTROL_STALE_AGE_FACTOR = 3;

export interface ControlLiveReadout {
    state: ControlLinkState;
    /** Only channels the machine reports. Null = channel exists but sent no reading. */
    values: Partial<Record<ControlChannel, number | null>>;
    heatSet: number | null;
}

export interface ControlLiveInput extends SupportedControlChannelsInput {
    liveData: { heater: number | null; fan: number; drum: number; heater_set?: number | null } | null;
    connected: boolean;
    reconnecting: boolean;
    quality: ObservationQuality | null;
    lastValidReceivedAtMs?: number | null;
    nowMs?: number;
    pollIntervalMs?: number;
}

const badQuality = (quality: ObservationQuality | null) =>
    quality != null && quality !== 'valid' && quality !== 'retransmit';

export const controlLinkState = (
    input: Pick<
        ControlLiveInput,
        'connected' | 'reconnecting' | 'quality' | 'lastValidReceivedAtMs' | 'nowMs' | 'pollIntervalMs'
    >,
) => {
    if (!input.connected) return 'offline';
    if (input.reconnecting || badQuality(input.quality)) return 'stale';
    const last = input.lastValidReceivedAtMs;
    const poll = input.pollIntervalMs;
    const now = input.nowMs;
    if (last != null && poll != null && now != null && now - last > CONTROL_STALE_AGE_FACTOR * poll) return 'stale';
    return 'live';
};

/**
 * Fan and drum arrive as 0 even when the machine has no such channel, so a channel is only
 * listed when the machine reads it. Offline readings are dropped, never shown as 0.
 */
export const buildControlLiveReadout = (input: ControlLiveInput): ControlLiveReadout => {
    const state = controlLinkState(input);
    const data = state === 'offline' ? null : input.liveData;
    const supported = resolveSupportedControlChannels(input);
    const raw: Record<ControlChannel, number | null> = {
        drum: data?.drum ?? null,
        heat: data?.heater ?? null,
        fan: data?.fan ?? null,
    };
    const values: ControlLiveReadout['values'] = {};
    for (const channel of ['drum', 'heat', 'fan'] as const) {
        if (!supported[channel]) continue;
        values[channel] = raw[channel];
    }
    return { state, values, heatSet: data?.heater_set ?? null };
};

/** Step value of a setpoint plan at `timeSec`. Null before the first step and after the last. */
export const stepValueAt = (plan: { xs: number[]; values: number[] } | undefined, timeSec: number) => {
    if (!plan?.xs.length || timeSec < plan.xs[0] || timeSec > plan.xs[plan.xs.length - 1]) return null;
    for (let i = plan.xs.length - 1; i >= 0; i--) {
        if (timeSec >= plan.xs[i]) return plan.values[i] ?? null;
    }
    return null;
};

export type ControlReadoutKind = 'measured' | 'set' | 'target';

export interface ControlReadoutEntry {
    key: string;
    channel: ControlChannel;
    kind: ControlReadoutKind;
    label: string;
    /** Undefined = legend only (saved record). Null = no reading, shown as a dash. */
    text?: string | null;
    unit: string;
    stale: boolean;
}

export interface ControlReadoutGroups {
    left: ControlReadoutEntry[];
    right: ControlReadoutEntry[];
    ownScale: ControlReadoutEntry[];
    leftUnit: string | null;
    rightUnit: string | null;
    state?: ControlLinkState;
}

export interface ControlReadoutParams {
    shown: Record<ControlChannel, boolean>;
    axes: ControlAxisLayout;
    units: ControlUnits;
    /** Absent for saved records: entries become a legend without numbers. */
    live?: ControlLiveReadout;
    hasHeatSet: boolean;
    heatTargetNow?: number | null;
}

/**
 * Entries grouped by the axis their curve is drawn on. Hidden channels and channels
 * the machine does not report get no entry.
 */
export const buildControlReadoutGroups = (params: ControlReadoutParams): ControlReadoutGroups => {
    const { shown, axes, units, live, hasHeatSet, heatTargetNow } = params;
    const groups: ControlReadoutGroups = {
        left: [],
        right: [],
        ownScale: [],
        leftUnit: axes.left.unit,
        rightUnit: axes.right.unit,
        state: live?.state,
    };
    const stale = live?.state === 'stale';
    for (const channel of ['drum', 'heat', 'fan'] as const) {
        if (!shown[channel]) continue;
        if (live && !(channel in live.values)) continue;
        const unit = units[channel].unit;
        const entries: ControlReadoutEntry[] = [
            {
                key: channel,
                channel,
                kind: 'measured',
                label: CONTROL_CHANNEL_LABEL[channel],
                text: live ? formatControlValue(live.values[channel]) : undefined,
                unit,
                stale,
            },
        ];
        if (channel === 'heat' && (hasHeatSet || live?.heatSet != null)) {
            entries.push({
                key: 'heat-set',
                channel,
                kind: 'set',
                label: 'set',
                text: live ? formatControlValue(live.heatSet) : undefined,
                unit,
                stale,
            });
        }
        if (channel === 'heat' && heatTargetNow !== undefined) {
            entries.push({
                key: 'heat-target',
                channel,
                kind: 'target',
                label: 'target',
                text: live ? formatControlValue(heatTargetNow) : undefined,
                unit,
                stale: false,
            });
        }
        const axis = axes.axisOf[channel];
        const group =
            axis === CONTROL_LEFT_AXIS ? groups.left : axis === CONTROL_RIGHT_AXIS ? groups.right : groups.ownScale;
        group.push(...entries);
    }
    return groups;
};
