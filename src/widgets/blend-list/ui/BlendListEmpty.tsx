import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const BlendListEmpty = ({ onAdd }: { onAdd: () => void }) => {
    const { t } = useTranslation();

    return (
        <div className="bg-main-bg dark:border dark:border-[#585d61] rounded-xl px-4 py-20 flex flex-col items-center justify-center gap-5 select-none">
            <div className="text-[13px] text-muted text-center leading-relaxed">
                {t('beans.blend.empty')}
                <br />
                {t('beans.blend.addBlendFirst')}
            </div>
            <button
                onClick={onAdd}
                className="flex items-center gap-1.5 text-[13px] font-medium text-primary px-4 py-2 rounded-lg bg-surface dark:bg-surface-elevated cursor-pointer hover:bg-surface-raised transition-colors"
            >
                <Plus size={14} strokeWidth={2} />
                {t('beans.blend.addBlend')}
            </button>
        </div>
    );
};
