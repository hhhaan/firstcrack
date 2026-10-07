import { ROASTER_REGISTRY } from '@entities/machine';
import type { ControlChannel, ControlLimits } from './control-channels';

export type SidecarControlRole = 'heater' | 'fan' | 'drum';

const CONTROL_ROLES: readonly SidecarControlRole[] = ['heater', 'fan', 'drum'];

/** Roles declared in a connect params map (channels / modbus_registers / channel_nodes). */
export const readableRolesFromParams = (params: Record<string, unknown> | undefined): SidecarControlRole[] => {
    if (!params) return [];
    const roles = new Set<SidecarControlRole>();
    const channels = params.channels;
    if (Array.isArray(channels)) {
        for (const ch of channels) {
            if (!ch || typeof ch !== 'object') continue;
            const role = String((ch as { role?: string }).role ?? '').toLowerCase();
            if (role === 'heater' || role === 'fan' || role === 'drum') roles.add(role);
        }
    }
    const registers = params.modbus_registers;
    if (registers && typeof registers === 'object') {
        for (const [key, val] of Object.entries(registers)) {
            if (val == null) continue;
            const role = key.toLowerCase();
            if (role === 'heater' || role === 'fan' || role === 'drum') roles.add(role);
        }
    }
    const nodes = params.channel_nodes;
    if (nodes && typeof nodes === 'object') {
        for (const key of Object.keys(nodes)) {
            const role = key.toLowerCase();
            if (role === 'heater' || role === 'fan' || role === 'drum') roles.add(role);
        }
    }
    return [...roles];
};

export interface SupportedControlChannelsInput {
    roasterKey?: string | null;
    connectionParams?: Record<string, unknown>;
    capabilities: readonly string[];
    limits?: ControlLimits;
}

/**
 * Which aux channels the connected machine actually reads.
 * Uses preset read maps, custom connection params, write limits, and capabilities
 * (capabilities alone never removes a readable channel).
 */
export const resolveSupportedControlChannels = (
    input: SupportedControlChannelsInput,
): Record<ControlChannel, boolean> => {
    const key = input.roasterKey ?? undefined;
    const preset = key ? ROASTER_REGISTRY[key] : undefined;
    const merged = { ...(preset?.default_params ?? {}), ...(input.connectionParams ?? {}) };
    const roles = new Set<SidecarControlRole>();
    for (const role of preset?.readable_controls ?? []) {
        if (role === 'heater' || role === 'fan' || role === 'drum') roles.add(role);
    }
    for (const role of readableRolesFromParams(merged)) roles.add(role);
    for (const cap of input.capabilities) {
        if (cap === 'heater' || cap === 'fan' || cap === 'drum') roles.add(cap);
    }
    for (const role of CONTROL_ROLES) {
        if (input.limits?.[role] != null) roles.add(role);
    }
    return {
        drum: roles.has('drum'),
        heat: roles.has('heater'),
        fan: roles.has('fan'),
    };
};

export const supportedChannelVisible = (
    channel: ControlChannel,
    shown: boolean,
    supported?: Record<ControlChannel, boolean>,
): boolean => shown && (supported?.[channel] ?? true);
