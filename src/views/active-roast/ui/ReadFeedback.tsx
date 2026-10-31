import { useRoastingStore } from '@features/active-roast/model/status';
import { feedbackValue, formatFeedback } from '@shared/lib/feedback';
import type { ReadUnits } from '@shared/types/sidecar';
import { useTranslation } from 'react-i18next';

/** Measured channels stay visible on read-only machines, without setpoint controls. */
export function ReadFeedback() {
    const { t } = useTranslation();
    const live = useRoastingStore((state) => state.liveData);
    const connected = useRoastingStore((state) => state.sidecarConnected);
    const units: ReadUnits = live?.processing?.read_units ?? {};
    const roles = (['heater', 'fan', 'drum'] as const).filter((role) => units[role]);
    if (!connected || !live || (roles.length === 0 && !live.extra_readings?.length)) return null;
    const autoStatus = live.extra_readings?.find((reading) => reading.id === 'auto_status');
    return (
        <div>
            <dl className="m-0 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                {roles.map((role) => {
                    const value = live.stale ? null : feedbackValue(live[role], role, units);
                    return (
                        <div key={role}>
                            <dt className="text-muted">
                                {t(
                                    `settings.firescope.feedback.${role === 'fan' && units.fan === 'Pa' ? 'airPressure' : role}`,
                                )}
                            </dt>
                            <dd className="m-0 font-mono text-primary">
                                {value == null ? '—' : formatFeedback(value, role, units)}
                            </dd>
                        </div>
                    );
                })}
                {live.extra_readings?.map((reading) => (
                    <div key={reading.id}>
                        <dt className="text-muted">
                            {reading.id === 'auto_status' ? t('machines.loringAuto.label') : reading.label}
                        </dt>
                        <dd className="m-0 font-mono text-primary">
                            {reading.id === 'auto_status'
                                ? live.stale || reading.value == null
                                    ? '—'
                                    : t(reading.value > 0 ? 'machines.loringAuto.on' : 'machines.loringAuto.off')
                                : live.stale || reading.value == null
                                  ? '—'
                                  : `${reading.value}${reading.unit ? ` ${reading.unit}` : ''}`}
                        </dd>
                    </div>
                ))}
            </dl>
            {autoStatus ? (
                <p className="mt-2 mb-0 max-w-xl text-[11px] leading-4 text-muted">{t('machines.loringAuto.hint')}</p>
            ) : null}
        </div>
    );
}
