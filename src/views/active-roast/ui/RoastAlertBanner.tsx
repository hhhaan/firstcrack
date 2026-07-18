import { PHASE_COLORS } from '@features/active-roast/lib/colors';
import type { RoastAlertKind } from '@features/active-roast/lib/roastAlerts';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const ALERT_KEYS: Record<RoastAlertKind, string> = {
    'ror-crash': 'activeRoast.alerts.rorCrash',
    'bt-over': 'activeRoast.alerts.btOver',
};

interface RoastAlertBannerProps {
    alerts: RoastAlertKind[];
}

export const RoastAlertBanner = ({ alerts }: RoastAlertBannerProps) => {
    const { t } = useTranslation();
    if (alerts.length === 0) return null;

    return (
        <div role="status" aria-live="assertive" className="flex flex-col gap-1">
            {alerts.map((kind) => (
                <div
                    key={kind}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold"
                    style={{ background: PHASE_COLORS.dangerBg, color: PHASE_COLORS.danger }}
                >
                    <TriangleAlert size={12} className="shrink-0" />
                    <span>{t(ALERT_KEYS[kind])}</span>
                </div>
            ))}
        </div>
    );
};
