import { useTranslation } from 'react-i18next';

/** Star pill: shows "default" when `id` is the default profile, otherwise a button to make it so. */
export const ProfileDefaultBadge = ({
    id,
    defaultId,
    onSetDefault,
}: {
    id: string;
    defaultId: string | null;
    onSetDefault: (id: string) => void;
}) => {
    const { t } = useTranslation();
    if (defaultId === id) {
        return (
            <div className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[#EFEFF0] px-2.5 py-1 dark:bg-surface-elevated">
                <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="text-[#FFB900]"
                    strokeWidth={2}
                >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span className="text-[11px] font-medium tracking-[0.3px]">{t('profiles.detail.default')}</span>
            </div>
        );
    }
    return (
        <button
            type="button"
            onClick={() => onSetDefault(id)}
            title={t('profiles.detail.setDefault')}
            className="flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border-none bg-surface px-2.5 py-1 transition-colors hover:bg-palette-teal/12 dark:bg-surface-elevated"
        >
            <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                color="#FFB900"
                stroke="currentColor"
                strokeWidth={2}
            >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <span className="text-[11px] font-medium tracking-[0.3px] text-muted">
                {t('profiles.detail.setDefault')}
            </span>
        </button>
    );
};
