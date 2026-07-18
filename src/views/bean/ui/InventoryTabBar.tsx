import { FEATURE, useFeature } from '@shared/lib/features';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type InventoryTab = 'green' | 'roasted' | 'products';

interface InventoryTabBarProps {
    active: InventoryTab;
    onChange: (tab: InventoryTab) => void;
}

export const InventoryTabBar = ({ active, onChange }: InventoryTabBarProps) => {
    const { t } = useTranslation();
    const canRoasted = useFeature(FEATURE.roastedInventory);
    const canProducts = useFeature(FEATURE.productStock);

    const tabs: { id: InventoryTab; label: string; locked: boolean }[] = [
        { id: 'green', label: t('inventory.tabs.green'), locked: false },
        { id: 'roasted', label: t('inventory.tabs.roasted'), locked: !canRoasted },
        { id: 'products', label: t('inventory.tabs.products'), locked: !canProducts },
    ];

    return (
        <div className="mb-4 flex gap-1 border-b border-border-subtle">
            {tabs.map(({ id, label, locked }) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => onChange(id)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors ${
                        active === id ? 'border-b-2 border-primary text-primary' : 'text-muted hover:text-secondary'
                    }`}
                >
                    {label}
                    {locked && <Lock size={11} className="shrink-0" aria-hidden />}
                </button>
            ))}
        </div>
    );
};
