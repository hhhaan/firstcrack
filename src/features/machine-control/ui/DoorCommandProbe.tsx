import { captureDoorProbe, captureDoorProbeFailure } from '@shared/lib/sentry';
import { isSidecarHttpError, sidecar } from '@shared/lib/sidecar';
import type { DoorProbeAction, DoorProbeResult } from '@shared/types/sidecar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const ACTIONS = [
    ['read', 'machines.doorProbe.read'],
    ['fill_open', 'machines.doorProbe.fillOpen'],
    ['fill_close', 'machines.doorProbe.fillClose'],
    ['discharge_open', 'machines.doorProbe.dischargeOpen'],
    ['discharge_close', 'machines.doorProbe.dischargeClose'],
] as const satisfies ReadonlyArray<readonly [DoorProbeAction, string]>;

const bit = (open: boolean) => (open ? '1' : '0');
const DOOR_PROBE_ROASTERS = new Set(['giesen_w45a_w60a', 'virtual']);

export const DoorCommandProbe = ({ roaster, disabled }: { roaster: string | null; disabled: boolean }) => {
    const { t } = useTranslation();
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<DoorProbeResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    if (!roaster || !DOOR_PROBE_ROASTERS.has(roaster)) return null;

    const send = async (action: DoorProbeAction) => {
        setSending(true);
        setError(null);
        try {
            const result = await sidecar.doorProbe(action);
            setResult(result);
            captureDoorProbe(result);
        } catch (caught) {
            setResult(null);
            const message = isSidecarHttpError(caught) ? caught.message : t('machines.doorProbe.failed');
            setError(message);
            captureDoorProbeFailure(action, message);
        } finally {
            setSending(false);
        }
    };

    return (
        <section className="flex flex-col gap-1.5" aria-label={t('machines.doorProbe.title')}>
            <span className="text-[11px] font-semibold text-secondary">{t('machines.doorProbe.title')}</span>
            <div className="grid grid-cols-2 gap-1">
                {ACTIONS.map(([action, label]) => (
                    <button
                        key={action}
                        type="button"
                        disabled={disabled || sending}
                        onClick={() => void send(action)}
                        className="cursor-pointer rounded-md border border-border-subtle bg-transparent px-1 py-1 text-[11px] text-primary disabled:cursor-default disabled:opacity-50"
                    >
                        {t(label)}
                    </button>
                ))}
            </div>
            {result && (
                <p className="m-0 text-[11px] leading-snug text-secondary">
                    {t('machines.doorProbe.command', { before: result.command_before, after: result.command_after })}
                    <br />
                    {result.wrote == null
                        ? t('machines.doorProbe.readOnly')
                        : t(result.command_held ? 'machines.doorProbe.wroteHeld' : 'machines.doorProbe.wroteLost', {
                              wrote: result.wrote,
                          })}
                    <br />
                    {t('machines.doorProbe.status', {
                        before: bit(result.discharge_open_before),
                        after: bit(result.discharge_open_after),
                    })}
                    <br />
                    {t('machines.doorProbe.notPosition')}
                </p>
            )}
            {error && <p className="m-0 text-[11px] leading-snug text-red-500">{error}</p>}
        </section>
    );
};
