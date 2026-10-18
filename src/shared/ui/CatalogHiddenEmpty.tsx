import { useTranslation } from 'react-i18next';

type CatalogHiddenEmptyProps = {
    messageKey: string;
    onShowHidden?: () => void;
    className?: string;
};

export const CatalogHiddenEmpty = ({ messageKey, onShowHidden, className }: CatalogHiddenEmptyProps) => {
    const { t } = useTranslation();
    return (
        <div
            className={className ?? 'flex flex-col items-center gap-3 text-center text-sm tracking-[0.14px] text-muted'}
        >
            <span>{t(messageKey)}</span>
            {onShowHidden ? (
                <button
                    type="button"
                    onClick={onShowHidden}
                    className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
                >
                    {t('catalog.showHidden')}
                </button>
            ) : null}
        </div>
    );
};

export function beanListEmptyMessageKey(catalogTotal: number, visibleCount: number): string {
    if (catalogTotal > 0 && visibleCount === 0) return 'beanList.allHidden';
    if (visibleCount === 0) return 'beanList.empty';
    return 'beanList.noResults';
}

export function beanDetailEmptyMessageKey(allHidden: boolean, hasAny: boolean): string {
    if (allHidden) return 'beanDetail.empty.allHidden';
    if (hasAny) return 'beanDetail.empty.select';
    return 'beanDetail.empty.addFirst';
}
