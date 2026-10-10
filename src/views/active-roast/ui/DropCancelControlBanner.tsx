import { useTranslation } from 'react-i18next';

interface DropCancelControlBannerProps {
    message: string;
    onRestorePid: () => void;
    showRestorePid: boolean;
    restoreBusy: boolean;
}

export const DropCancelControlBanner = ({
    message,
    onRestorePid,
    showRestorePid,
    restoreBusy,
}: DropCancelControlBannerProps) => {
    const { t } = useTranslation();
    return (
        <div
            role="status"
            data-testid="drop-cancel-control-banner"
            className="flex items-center justify-between gap-3 rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-2"
        >
            <p className="text-sm font-medium text-primary">{message}</p>
            {showRestorePid && (
                <button
                    type="button"
                    data-testid="drop-cancel-restore-pid"
                    disabled={restoreBusy}
                    onClick={onRestorePid}
                    className="px-2.5 py-1 rounded-md border-none text-xs font-semibold cursor-pointer bg-primary text-white disabled:opacity-60"
                >
                    {t('activeRoast.dropCancelControl.restorePid')}
                </button>
            )}
        </div>
    );
};
