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
        <div className="mb-4 flex gap-1 border-b border-border-subtle">
            {tabs.map(({ id, label }) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => onChange(id)}
                    className={`px-3 py-2 text-[13px] font-medium transition-colors ${
                        active === id ? 'border-b-2 border-primary text-primary' : 'text-muted hover:text-secondary'
                    }`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
};
