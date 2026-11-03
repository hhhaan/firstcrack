import { cn } from '@shared/lib/cn';
import { isSidecarHttpError, sidecar } from '@shared/lib/sidecar';
import type { DoorProbeAction } from '@shared/types/sidecar';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import {
    ArrowDownToLine,
    ArrowUpFromLine,
    Check,
    CircleAlert,
    Fan,
    LoaderCircle,
    RotateCw,
    SlidersHorizontal,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const DEVICES = [
    {
        id: 'fill',
        icon: ArrowDownToLine,
        actions: [
            ['fill_open', 'open', 'fillOpen'],
            ['fill_close', 'close', 'fillClose'],
        ],
    },
    {
        id: 'discharge',
        icon: ArrowUpFromLine,
        actions: [
            ['discharge_open', 'open', 'dischargeOpen'],
            ['discharge_close', 'close', 'dischargeClose'],
        ],
    },
    {
        id: 'fan',
        icon: Fan,
        actions: [
            ['cooling_on', 'on', 'coolingOn'],
            ['cooling_off', 'off', 'coolingOff'],
        ],
    },
    {
        id: 'stirrer',
        icon: RotateCw,
        actions: [
            ['stirrer_on', 'on', 'stirrerOn'],
            ['stirrer_off', 'off', 'stirrerOff'],
        ],
    },
] as const;
type Device = (typeof DEVICES)[number];
type Command = Exclude<DoorProbeAction, 'read'>;
type Receipt = { label: string; error: string | null; sent?: Command };

export const DoorCommandProbe = ({
    roaster,
    disabled,
    hidden = false,
}: {
    roaster: string | null;
    disabled: boolean;
    hidden?: boolean;
}) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const inFlight = useRef(false);
    const [pending, setPending] = useState<Command | null>(null);
    const [receipts, setReceipts] = useState<Partial<Record<Device['id'], Receipt>>>({});
    if (roaster !== 'giesen_w45a_w60a' && roaster !== 'virtual') return null;

    const send = async (id: Device['id'], action: Command, label: string) => {
        if (disabled || hidden || inFlight.current) return;
        inFlight.current = true;
        setPending(action);
        try {
            await sidecar.doorProbe(action);
            setReceipts((current) => ({ ...current, [id]: { label, error: null, sent: action } }));
        } catch (caught) {
            const error = isSidecarHttpError(caught) ? caught.message : t('machines.doorProbe.failed');
            setReceipts((current) => ({ ...current, [id]: { label, error, sent: current[id]?.sent } }));
        } finally {
            inFlight.current = false;
            setPending(null);
        }
    };

    const controls = (device: Device, card: boolean) => {
        const busy = device.actions.some(([action]) => action === pending);
        const receipt = receipts[device.id];
        return (
            <section
                key={device.id}
                aria-label={t(`machines.doorProbe.${device.id}`)}
                aria-busy={busy}
                className={
                    card
                        ? 'min-w-0 rounded-lg border border-border bg-surface-elevated px-2 pt-3 pb-1'
                        : 'grid grid-cols-[1fr_116px] items-center pt-1.5'
                }
            >
                <div className={card ? 'mb-2.5 flex flex-col items-start gap-2.5' : 'flex items-center gap-2'}>
                    <device.icon
                        size={card ? 22 : 16}
                        strokeWidth={1.4}
                        aria-hidden="true"
                        className="shrink-0 text-secondary"
                    />
                    <h3 className="m-0 text-xs font-medium text-primary">{t(`machines.doorProbe.${device.id}`)}</h3>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                    {device.actions.map(([action, label, fullLabel]) => (
                        <button
                            key={action}
                            type="button"
                            aria-label={t(`machines.doorProbe.${fullLabel}`)}
                            aria-pressed={receipt?.sent === action}
                            disabled={disabled || hidden || pending !== null}
                            data-primary={receipt?.sent === action ? '' : undefined}
                            onClick={() => void send(device.id, action, label)}
                            className={cn(
                                'flex h-8 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-md border text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-40',
                                receipt?.sent === action
                                    ? 'border-action bg-action text-on-action hover:opacity-85'
                                    : 'border-strong-border bg-main-bg text-primary hover:bg-surface-hover',
                            )}
                        >
                            {pending === action && (
                                <LoaderCircle
                                    size={12}
                                    aria-hidden="true"
                                    className="shrink-0 animate-spin motion-reduce:animate-none"
                                />
                            )}
                            {t(`machines.doorProbe.${label}`)}
                        </button>
                    ))}
                </div>
                <div
                    role="status"
                    aria-atomic="true"
                    className={cn(
                        'mt-1 flex min-h-4 items-start gap-1 text-[9px] leading-4',
                        !card && 'col-span-2 justify-end',
                        !busy && receipt?.error ? 'text-phase-danger' : 'text-muted',
                    )}
                >
                    {busy ? (
                        t('machines.doorProbe.sending')
                    ) : receipt ? (
                        <>
                            {receipt.error ? (
                                <CircleAlert size={11} aria-hidden="true" className="mt-0.5 shrink-0" />
                            ) : (
                                <Check size={11} aria-hidden="true" className="mt-0.5 shrink-0" />
                            )}
                            <span>
                                {receipt.error ??
                                    t('machines.doorProbe.sent', { action: t(`machines.doorProbe.${receipt.label}`) })}
                            </span>
                        </>
                    ) : null}
                </div>
            </section>
        );
    };

    return (
        <Popover open={open && !hidden} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="group flex w-full cursor-pointer items-center justify-between gap-1 border-none bg-transparent p-0 text-left text-[11px] font-semibold text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                    <span>{t('machines.doorProbe.title')}</span>
                    <span
                        aria-hidden="true"
                        className="flex size-[26px] items-center justify-center rounded-md transition-colors group-hover:bg-surface group-data-[state=open]:bg-surface group-data-[state=open]:text-primary"
                    >
                        <SlidersHorizontal size={14} strokeWidth={1.7} />
                    </span>
                </button>
            </PopoverTrigger>
            <PopoverContent
                side="left"
                align="start"
                sideOffset={12}
                aria-label={t('machines.doorProbe.title')}
                className="w-[276px] max-w-[calc(100vw-24px)] max-h-(--radix-popover-content-available-height) overflow-y-auto rounded-xl border-border bg-main-bg p-4 shadow-(--shadow-ring) dark:[&_button[data-primary]]:!text-on-action"
            >
                <div className="pb-2.5 text-[10px] text-muted">{t('machines.doorProbe.doors')}</div>
                <div className="grid grid-cols-2 gap-2">
                    {DEVICES.slice(0, 2).map((device) => controls(device, true))}
                </div>
                <div className="mt-[18px] border-t border-border pt-4 pb-2.5 text-[10px] text-muted">
                    {t('machines.doorProbe.cooling')}
                </div>
                {DEVICES.slice(2).map((device) => controls(device, false))}
            </PopoverContent>
        </Popover>
    );
};
