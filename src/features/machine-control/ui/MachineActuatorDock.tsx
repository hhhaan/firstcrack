import { cn } from '@shared/lib/cn';
import { FEATURE, useFeature } from '@shared/lib/features';
import { isSidecarHttpError, sidecar } from '@shared/lib/sidecar';
import type { DoorProbeAction } from '@shared/types/sidecar';
import { ArrowDownToLine, ArrowUpFromLine, Check, CircleAlert, Fan, LoaderCircle, RotateCw } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ACTUATORS = [
    {
        id: 'fill',
        icon: ArrowDownToLine,
        actions: [
            ['fill_open', 'open'],
            ['fill_close', 'close'],
        ],
    },
    {
        id: 'discharge',
        icon: ArrowUpFromLine,
        actions: [
            ['discharge_open', 'open'],
            ['discharge_close', 'close'],
        ],
    },
    {
        id: 'cooling',
        icon: Fan,
        actions: [
            ['cooling_on', 'on'],
            ['cooling_off', 'off'],
        ],
    },
    {
        id: 'stirrer',
        icon: RotateCw,
        actions: [
            ['stirrer_on', 'on'],
            ['stirrer_off', 'off'],
        ],
    },
] as const;

type ActuatorId = (typeof ACTUATORS)[number]['id'];
type Command = Exclude<DoorProbeAction, 'read'>;
type Receipt = { label: string; error: string | null };

export const MachineActuatorDock = ({ roaster, disabled }: { roaster: string | null; disabled: boolean }) => {
    const entitled = useFeature(FEATURE.machineControl);
    if (!entitled || (roaster !== 'giesen_w45a_w60a' && roaster !== 'virtual')) return null;
    return <ActuatorControls key={roaster} disabled={disabled} />;
};

const ActuatorControls = ({ disabled }: { disabled: boolean }) => {
    const { t } = useTranslation();
    const inFlight = useRef(false);
    const [pending, setPending] = useState<Command | null>(null);
    const [receipts, setReceipts] = useState<Partial<Record<ActuatorId, Receipt>>>({});

    const send = async (id: ActuatorId, command: Command, label: string) => {
        if (disabled || inFlight.current) return;
        inFlight.current = true;
        setPending(command);
        try {
            await sidecar.doorProbe(command);
            setReceipts((current) => ({ ...current, [id]: { label, error: null } }));
        } catch (caught) {
            const error = isSidecarHttpError(caught) ? caught.message : t('machines.actuators.failed');
            setReceipts((current) => ({ ...current, [id]: { label, error } }));
        } finally {
            inFlight.current = false;
            setPending(null);
        }
    };

    return (
        <section
            aria-label={t('machines.actuators.title')}
            className="@container shrink-0 mt-3 mr-3 overflow-hidden rounded-xl border border-border bg-surface-elevated"
        >
            <div className="grid grid-cols-2 @[560px]:grid-cols-4">
                {ACTUATORS.map(({ id, icon: Icon, actions }, index) => {
                    const busy = actions.some(([command]) => command === pending);
                    const receipt = receipts[id];
                    return (
                        <div
                            key={id}
                            role="group"
                            aria-label={t(`machines.actuators.${id}`)}
                            aria-busy={busy}
                            className={cn(
                                'min-w-0 px-3 pt-3 pb-2',
                                index % 2 === 1 && 'border-l border-border',
                                index === 2 && '@[560px]:border-l @[560px]:border-border',
                                index > 1 && 'border-t border-border @[560px]:border-t-0',
                            )}
                        >
                            <div className="mb-2.5 flex items-center gap-2 text-primary">
                                <Icon
                                    size={17}
                                    strokeWidth={1.6}
                                    aria-hidden="true"
                                    className="shrink-0 text-secondary"
                                />
                                <span className="text-xs font-semibold">{t(`machines.actuators.${id}`)}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                                {actions.map(([command, label], actionIndex) => (
                                    <button
                                        key={command}
                                        type="button"
                                        disabled={disabled || pending !== null}
                                        aria-label={t('machines.actuators.command', {
                                            device: t(`machines.actuators.${id}`),
                                            action: t(`machines.actuators.${label}`),
                                        })}
                                        onClick={() => void send(id, command, label)}
                                        className={cn(
                                            'flex h-9 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-md border text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-40',
                                            actionIndex === 0
                                                ? 'border-action bg-action text-on-action hover:opacity-85'
                                                : 'border-strong-border bg-main-bg text-primary hover:bg-surface-hover',
                                        )}
                                    >
                                        {pending === command && (
                                            <LoaderCircle
                                                size={12}
                                                aria-hidden="true"
                                                className="shrink-0 animate-spin motion-reduce:animate-none"
                                            />
                                        )}
                                        {t(`machines.actuators.${label}`)}
                                    </button>
                                ))}
                            </div>
                            <div
                                role="status"
                                aria-atomic="true"
                                className={cn(
                                    'mt-1.5 flex min-h-4 items-start gap-1 text-[10px] leading-4',
                                    !busy && receipt?.error ? 'text-phase-danger' : 'text-muted',
                                )}
                            >
                                {busy ? (
                                    t('machines.actuators.sending')
                                ) : receipt ? (
                                    <>
                                        {receipt.error ? (
                                            <CircleAlert size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                                        ) : (
                                            <Check size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                                        )}
                                        <span>
                                            {receipt.error ??
                                                t('machines.actuators.sent', {
                                                    action: t(`machines.actuators.${receipt.label}`),
                                                })}
                                        </span>
                                    </>
                                ) : null}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};
