import { useTranslation } from 'react-i18next';

/** Star pill that toggles whether `id` is the account default profile. */
export const ProfileDefaultBadge = ({
    id,
    defaultId,
    onSetDefault,
}: {
    id: string;
    defaultId: string | null;
    onSetDefault: (id: string | null) => void;
}) => {
    const { t } = useTranslation();
    const isDefault = defaultId === id;
    return (
        <button
            type="button"
            aria-pressed={isDefault}
            onClick={() => onSetDefault(isDefault ? null : id)}
            title={isDefault ? t('profiles.detail.default') : t('profiles.detail.setDefault')}
            className={`flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border-none px-2.5 py-1 dark:bg-surface-elevated ${
                isDefault ? 'bg-[#EFEFF0]' : 'bg-surface transition-colors hover:bg-palette-teal/12'
            }`}
        >
            <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill={isDefault ? 'currentColor' : 'none'}
                className={isDefault ? 'text-[#FFB900]' : undefined}
                color={isDefault ? undefined : '#FFB900'}
                stroke={isDefault ? undefined : 'currentColor'}
                strokeWidth={2}
            >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <span className={`text-[11px] font-medium tracking-[0.3px] ${isDefault ? '' : 'text-muted'}`}>
                {isDefault ? t('profiles.detail.default') : t('profiles.detail.setDefault')}
            </span>
        </button>
    );
};
