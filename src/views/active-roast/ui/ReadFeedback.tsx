import { useRoastingStore } from '@features/active-roast/model/status';
import { feedbackLabel, feedbackValue, formatFeedback } from '@shared/lib/feedback';
import type { ExtraSensorReading, ReadUnits } from '@shared/types/sidecar';
import { useTranslation } from 'react-i18next';

const readingCell = 'flex min-w-0 flex-col items-start break-words';
const readingLabel = 'flex-1 text-left text-[11px] font-medium leading-none text-muted';
const readingValue = 'm-0 mt-1 font-inconsolata text-[15px] font-medium tabular-nums leading-none text-primary';

/** Measured channels stay visible on read-only machines, without setpoint controls. */
export function ReadFeedback() {
    const { t } = useTranslation();
    const live = useRoastingStore((state) => state.liveData);
    const connected = useRoastingStore((state) => state.sidecarConnected);
    const units: ReadUnits = live?.processing?.read_units ?? {};
    const roles = (['heater', 'fan', 'drum'] as const).filter((role) => units[role] !== undefined);
    if (!connected || !live || (roles.length === 0 && !live.extra_readings?.length)) return null;
    const autoStatus = live.extra_readings?.find((reading) => reading.id === 'auto_status');
    const extraText = (reading: ExtraSensorReading) => {
        if (live.stale || reading.value == null) return '—';
        if (reading.id === 'auto_status') {
            return t(reading.value > 0 ? 'machines.loringAuto.on' : 'machines.loringAuto.off');
        }
        return `${reading.value}${reading.unit ? ` ${reading.unit}` : ''}`;
    };
    return (
        <div className="min-w-0">
            <dl className="m-0 grid grid-cols-3 gap-x-2 gap-y-2 text-left text-[11px]">
                {roles.map((role) => {
                    const value = live.stale ? null : feedbackValue(live[role], role, units);
                    return (
                        <div key={role} className={readingCell}>
                            <dt className={readingLabel}>{feedbackLabel(role, units)}</dt>
                            <dd className={readingValue}>{value == null ? '—' : formatFeedback(value, role, units)}</dd>
                        </div>
                    );
                })}
                {live.extra_readings?.map((reading) => (
                    <div key={reading.id} className={readingCell}>
                        <dt className={readingLabel}>
                            {reading.id === 'auto_status' ? t('machines.loringAuto.label') : reading.label}
                        </dt>
                        <dd className={readingValue}>{extraText(reading)}</dd>
                    </div>
                ))}
            </dl>
            {autoStatus ? (
                <p className="mt-2 mb-0 max-w-xl text-[11px] leading-4 text-muted">{t('machines.loringAuto.hint')}</p>
            ) : null}
        </div>
    );
}
