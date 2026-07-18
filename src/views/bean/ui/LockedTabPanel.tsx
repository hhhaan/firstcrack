import { PillButton } from '@shared/ui/PillButton';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface LockedTabPanelProps {
    titleKey: string;
    descriptionKey: string;
    onUpgrade?: () => void;
}

export const LockedTabPanel = ({ titleKey, descriptionKey, onUpgrade }: LockedTabPanelProps) => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle bg-main-bg px-6 py-20 text-center dark:border-[#585d61]">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface">
                <Lock size={22} className="text-muted" />
            </div>
            <div>
                <p className="text-[15px] font-medium text-primary">{t(titleKey)}</p>
                <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted">{t(descriptionKey)}</p>
            </div>
            {onUpgrade ? <PillButton onClick={onUpgrade}>{t('inventory.locked.cta')}</PillButton> : null}
        </div>
    );
};
