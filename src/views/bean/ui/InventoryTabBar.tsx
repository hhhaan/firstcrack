import { useTranslation } from 'react-i18next';

export type InventoryTab = 'green' | 'roasted' | 'products';

interface InventoryTabBarProps {
    active: InventoryTab;
    onChange: (tab: InventoryTab) => void;
}

export const InventoryTabBar = ({ active, onChange }: InventoryTabBarProps) => {
    const { t } = useTranslation();

    const tabs: { id: InventoryTab; label: string }[] = [
        { id: 'green', label: t('inventory.tabs.green') },
        { id: 'roasted', label: t('inventory.tabs.roasted') },
        { id: 'products', label: t('inventory.tabs.products') },
    ];

    return (
        <div className="mb-6 flex gap-1 border-b border-border-subtle dark:border-border">
            {tabs.map(({ id, label }) => {
                const isActive = active === id;
                return (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onChange(id)}
                        className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium tracking-[0.14px] transition-colors cursor-pointer ${
                            isActive
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted hover:text-secondary'
                        }`}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
};
