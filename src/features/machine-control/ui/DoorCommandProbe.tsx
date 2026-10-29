import { cn } from '@shared/lib/cn';
import { captureDoorProbe, captureDoorProbeFailure } from '@shared/lib/sentry';
import { isSidecarHttpError, sidecar } from '@shared/lib/sidecar';
import type { DoorProbeAction } from '@shared/types/sidecar';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const ACTIONS = [
    ['read', 'machines.doorProbe.read'],
    ['fill_open', 'machines.doorProbe.fillOpen'],
    ['fill_close', 'machines.doorProbe.fillClose'],
    ['discharge_open', 'machines.doorProbe.dischargeOpen'],
    ['discharge_close', 'machines.doorProbe.dischargeClose'],
    ['cooling_on', 'machines.doorProbe.coolingOn'],
    ['cooling_off', 'machines.doorProbe.coolingOff'],
    ['stirrer_on', 'machines.doorProbe.stirrerOn'],
    ['stirrer_off', 'machines.doorProbe.stirrerOff'],
] as const satisfies ReadonlyArray<readonly [DoorProbeAction, string]>;

type Pair = 'fill' | 'discharge' | 'cooling' | 'stirrer';

const PAIR: Partial<Record<DoorProbeAction, Pair>> = {
    fill_open: 'fill',
    fill_close: 'fill',
    discharge_open: 'discharge',
    discharge_close: 'discharge',
    cooling_on: 'cooling',
    cooling_off: 'cooling',
    stirrer_on: 'stirrer',
    stirrer_off: 'stirrer',
};

const DOOR_PROBE_ROASTERS = new Set(['giesen_w45a_w60a', 'virtual']);

const pressedOf = (
    action: DoorProbeAction,
    pending: DoorProbeAction | null,
    latched: Partial<Record<Pair, DoorProbeAction>>,
) => {
    if (pending === action) return true;
    const pair = PAIR[action];
    if (!pair || (pending !== null && PAIR[pending] === pair)) return false;
    return latched[pair] === action;
};

export const DoorCommandProbe = ({ roaster, disabled }: { roaster: string | null; disabled: boolean }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState<DoorProbeAction | null>(null);
    const [latched, setLatched] = useState<Partial<Record<Pair, DoorProbeAction>>>({});
    if (!roaster || !DOOR_PROBE_ROASTERS.has(roaster)) return null;

    const send = async (action: DoorProbeAction) => {
        setPending(action);
        setSending(true);
        setError(null);
        try {
            captureDoorProbe(await sidecar.doorProbe(action));
            const pair = PAIR[action];
            if (pair) setLatched((current) => ({ ...current, [pair]: action }));
        } catch (caught) {
            const message = isSidecarHttpError(caught) ? caught.message : t('machines.doorProbe.failed');
            setError(message);
            captureDoorProbeFailure(action, message);
        } finally {
            setSending(false);
            setPending(null);
        }
    };

    return (
        <section className="flex flex-col gap-1.5" aria-label={t('machines.doorProbe.title')} aria-busy={sending}>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
                className="flex cursor-pointer items-center justify-between gap-1 border-none bg-transparent p-0 text-left text-[11px] font-semibold text-secondary"
            >
                {t('machines.doorProbe.title')}
                {open ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
            </button>
            {open && (
                <>
                    {sending && (
                        <div
                            role="progressbar"
                            aria-label={t('machines.doorProbe.title')}
                            className="h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
                        >
                            <div className="h-full w-2/5 animate-[door-probe_0.9s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:w-full motion-reduce:animate-pulse" />
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-1">
                        {ACTIONS.map(([action, label]) => {
                            const pair = PAIR[action];
                            const pressed = pressedOf(action, pending, latched);
                            return (
                                <button
                                    key={action}
                                    type="button"
                                    disabled={disabled || sending}
                                    aria-pressed={pair ? pressed : undefined}
                                    onClick={() => void send(action)}
                                    className={cn(
                                        'cursor-pointer rounded-md border border-black/10 bg-surface px-1 py-1 text-[11px] text-primary transition-[background-color,border-color,filter] duration-75 hover:bg-surface-hover active:brightness-90 disabled:cursor-default dark:border-white/10',
                                        disabled && 'disabled:opacity-50',
                                        pressed && 'border-primary/40 bg-surface-hover font-semibold brightness-90',
                                    )}
                                >
                                    {t(label)}
                                </button>
                            );
                        })}
                    </div>
                    {error && <p className="m-0 text-[11px] leading-snug text-red-500">{error}</p>}
                </>
            )}
        </section>
    );
};
