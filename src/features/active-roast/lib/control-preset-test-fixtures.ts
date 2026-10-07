import { ROASTER_REGISTRY } from '@entities/machine';

/** Preset with readable drum/fan but no write capabilities (Bühler-like). */
export const presetReadonlyDrumFan = Object.keys(ROASTER_REGISTRY).find((key) => {
    const def = ROASTER_REGISTRY[key];
    return (
        def.capabilities.length === 0 &&
        (def.readable_controls ?? []).includes('drum') &&
        (def.readable_controls ?? []).includes('fan')
    );
});

/** Heater-only preset (Loring-like). */
export const presetHeaterOnly = Object.keys(ROASTER_REGISTRY).find((key) => {
    const def = ROASTER_REGISTRY[key];
    const caps = def.capabilities;
    const readable = def.readable_controls ?? [];
    return caps.length === 1 && caps[0] === 'heater' && readable.length === 1 && readable[0] === 'heater';
});
