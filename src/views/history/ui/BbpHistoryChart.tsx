import { useBbpCurve } from '@entities/roast';
import { formatTemp, toDisplayTemp, useRoastSettings } from '@features/active-roast';
import { RoastTempChart } from '@features/active-roast/ui/RoastTempChart';
import { formatDuration } from '@shared/lib/format';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { useTranslation } from 'react-i18next';

export function BbpHistoryChart({ session }: { session: RoastSessionWithRelations }) {
    const { t } = useTranslation();
    const { temperatureUnit: unit, tempMinC, tempMaxC } = useRoastSettings();
    const { data: points = [], isLoading, isError } = useBbpCurve(session.user_id, session.id, session.bbp_tsv_path);

    return (
        <section className="mt-4 rounded bg-surface-elevated p-3" aria-label={t('bbp.history')}>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-secondary">
                <h3 className="font-semibold">{t('bbp.history')}</h3>
                <span>
                    {t('bbp.duration')}: {formatDuration(session.bbp_seconds)}
                </span>
                <span>
                    {t('bbp.chargeTemp')}: {formatTemp(session.charge_temp_celsius, unit)}
                </span>
                <span>{t('bbp.timeOrigin')}</span>
            </div>
            {isLoading ? (
                <p role="status" className="py-4 text-xs text-muted">
                    {t('bbp.loading')}
                </p>
            ) : isError ? (
                <p role="status" className="py-4 text-xs text-muted">
                    {t('bbp.failed')}
                </p>
            ) : points.length === 0 ? (
                <p className="py-4 text-xs text-muted">{t('bbp.empty')}</p>
            ) : (
                <>
                    <p className="mt-3 text-xs">
                        <span className="text-sensor-bt">BT</span> · <span className="text-sensor-et">ET</span>
                    </p>
                    <RoastTempChart
                        xs={points.map((p) => p.t)}
                        btActual={points.map((p) => toDisplayTemp(p.bt, unit))}
                        etActual={points.map((p) => (p.et == null ? null : toDisplayTemp(p.et, unit)))}
                        rorActual={[]}
                        btTarget={[]}
                        showTargetCurve={false}
                        showRoR={false}
                        showRoRET={false}
                        currentTimeSec={0}
                        eventMarkers={[]}
                        temperatureUnit={unit}
                        tempMinC={Math.min(
                            tempMinC,
                            ...points.map((p) => Math.floor(Math.min(p.bt, p.et ?? p.bt) / 10) * 10),
                        )}
                        tempMaxC={Math.max(
                            tempMaxC,
                            ...points.map((p) => Math.ceil(Math.max(p.bt, p.et ?? p.bt) / 10) * 10),
                        )}
                        xViewMin={0}
                        xViewMax={Math.max(1, session.bbp_seconds ?? 0, points[points.length - 1].t)}
                        height={260}
                    />
                </>
            )}
        </section>
    );
}
