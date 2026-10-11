import { type ControlCapability, machineDoorControl, ROASTER_REGISTRY } from '@entities/machine';

const CHANNELS = ['heater', 'fan', 'drum'] as const;
/** Same set as the sidecar. Read capabilities do not make a protocol writable. */
const WRITABLE_PROTOCOLS = new Set(['s7', 'virtual']);

/**
 * Dev-only stand-in for `/status.control` when nothing is connected.
 * `VITE_DEV_ROASTER` is a registry key. Limits are display ranges, not the write map.
 */
export function devRoasterControl(): ControlCapability | null {
    if (!import.meta.env.DEV) return null;
    const key = import.meta.env.VITE_DEV_ROASTER?.trim();
    const def = key ? ROASTER_REGISTRY[key] : undefined;
    if (!key || !def || !WRITABLE_PROTOCOLS.has(def.protocol)) return null;

    const limits: ControlCapability['limits'] = {};
    for (const role of CHANNELS) {
        if (def.capabilities.includes(role)) limits[role] = { min: 0, max: 100, unit: '%' };
    }
    const doors = machineDoorControl({ roasterKey: key });
    if (Object.keys(limits).length === 0 && !doors) return null;

    return {
        writable: Object.keys(limits).length > 0,
        discharge: doors,
        fill: doors,
        limits,
        ...(def.pid && limits.heater ? { pid: { supported: true, sv_min: 50, sv_max: 250 } } : {}),
    };
}
