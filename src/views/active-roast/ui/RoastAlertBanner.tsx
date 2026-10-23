import { PHASE_COLORS } from '@features/active-roast/lib/colors';
import type { RoastAlertKind } from '@features/active-roast/lib/roastAlerts';
import { useRoastSettings } from '@features/active-roast/model/settings';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const ALERT_KEYS: Record<RoastAlertKind, string> = {
    'turning-point': 'activeRoast.alerts.turningPoint',
    'ror-crash': 'activeRoast.alerts.rorCrash',
    'bt-over': 'activeRoast.alerts.btOver',
    'after-charge': 'activeRoast.alerts.afterCharge',
    'before-fc': 'activeRoast.alerts.beforeFc',
    'before-drop': 'activeRoast.alerts.beforeDrop',
    'after-drop': 'activeRoast.alerts.afterDrop',
};

interface RoastAlertBannerProps {
    alerts: RoastAlertKind[];
}

export const RoastAlertBanner = ({ alerts }: RoastAlertBannerProps) => {
    const { t } = useTranslation();
    const settings = useRoastSettings();
    if (alerts.length === 0) return null;

    const minutesFor = (kind: RoastAlertKind): number | undefined => {
        if (kind === 'after-charge') return settings.alertAfterChargeMin;
        if (kind === 'before-fc') return settings.alertBeforeFcMin;
        if (kind === 'before-drop') return settings.alertBeforeDropMin;
        if (kind === 'after-drop') return settings.alertAfterDropMin;
        return undefined;
    };

    return (
        <div role="status" aria-live="assertive" className="flex flex-col gap-1">
            {alerts.map((kind) => (
                <div
                    key={kind}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold"
                    style={{ background: PHASE_COLORS.dangerBg, color: PHASE_COLORS.danger }}
                >
                    <TriangleAlert size={12} className="shrink-0" />
                    <span>{t(ALERT_KEYS[kind], { minutes: minutesFor(kind) })}</span>
                </div>
            ))}
        </div>
    );
};
