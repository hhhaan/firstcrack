import { useTranslation } from 'react-i18next';

interface UnsavedRoastBannerProps {
    timeStr: string;
    onReopen: () => void;
}

export const UnsavedRoastBanner = ({ timeStr, onReopen }: UnsavedRoastBannerProps) => {
    const { t } = useTranslation();
    return (
        <div
            role="status"
            data-testid="unsaved-roast-banner"
            className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface px-3 py-2"
        >
            <p className="text-sm text-primary">{t('activeRoast.unsaved.banner', { time: timeStr })}</p>
            <div className="flex items-center gap-2 shrink-0">
                <button
                    type="button"
                    data-testid="unsaved-roast-reopen"
                    onClick={onReopen}
                    className="px-2.5 py-1 rounded-md border-none text-xs font-semibold cursor-pointer bg-action text-on-action"
                >
                    {t('activeRoast.unsaved.reopen')}
                </button>
            </div>
        </div>
    );
};
