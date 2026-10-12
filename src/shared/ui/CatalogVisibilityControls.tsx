import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const CatalogVisibilityFilter = ({
    checked,
    onChange,
}: {
    checked: boolean;
    onChange: (next: boolean) => void;
}) => {
    const { t } = useTranslation();
    return (
        <label className="mb-3 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
            {t('catalog.showHidden')}
        </label>
    );
};
export const CatalogVisibilityButton = ({
    hidden,
    name,
    onToggle,
}: {
    hidden: boolean;
    name: string;
    onToggle: () => void;
}) => {
    const { t } = useTranslation();
    const label = t(hidden ? 'catalog.restore' : 'catalog.hide', { name });
    const Icon = hidden ? Eye : EyeOff;
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={(event) => {
                event.stopPropagation();
                onToggle();
            }}
            className="rounded p-1 text-muted hover:bg-surface hover:text-primary"
        >
            <Icon size={14} />
        </button>
    );
};
