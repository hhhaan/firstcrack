import { PillButton } from '@shared/ui/PillButton';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { InventoryTab } from './InventoryTabBar';

type Props = {
    tab: Exclude<InventoryTab, 'green'>;
    onUpgrade?: () => void;
};

export const InventoryLocked = ({ tab, onUpgrade }: Props) => {
    const { t } = useTranslation();
    const titleKey = tab === 'roasted' ? 'inventory.locked.roastedTitle' : 'inventory.locked.productsTitle';
    const descKey = tab === 'roasted' ? 'inventory.locked.roastedDescription' : 'inventory.locked.productsDescription';

    return (
        <div className="flex flex-col items-center justify-center gap-5 rounded-xl border border-border-subtle bg-main-bg px-6 py-20 text-center dark:border-[#585d61]">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted dark:bg-surface-elevated">
                <Lock size={22} strokeWidth={1.5} />
            </div>
            <div>
                <p className="text-[15px] font-medium text-primary tracking-[0.14px]">{t(titleKey)}</p>
                <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted tracking-[0.14px]">{t(descKey)}</p>
            </div>
            {onUpgrade ? <PillButton onClick={onUpgrade}>{t('inventory.locked.cta')}</PillButton> : null}
        </div>
    );
};
