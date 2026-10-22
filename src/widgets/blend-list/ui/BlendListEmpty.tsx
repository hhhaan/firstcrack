import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type BlendListEmptyProps = {
    hasBeans: boolean;
    onAdd: () => void;
    onNeedBeans: () => void;
};

export const BlendListEmpty = ({ hasBeans, onAdd, onNeedBeans }: BlendListEmptyProps) => {
    const { t } = useTranslation();

    if (!hasBeans) {
        return (
            <div className="bg-main-bg rounded-2xl border border-border px-4 py-20 flex flex-col items-center justify-center gap-5 select-none">
                <div className="text-[13px] text-muted text-center leading-relaxed">
                    {t('beans.blend.needBeansFirst')}
                </div>
                <SurfaceButton onClick={onNeedBeans} icon={<Plus size={14} strokeWidth={2} />} className="px-4 py-2">
                    {t('beans.addBean')}
                </SurfaceButton>
            </div>
        );
    }

    return (
        <div className="bg-main-bg rounded-2xl border border-border px-4 py-20 flex flex-col items-center justify-center gap-5 select-none">
            <div className="text-[13px] text-muted text-center leading-relaxed">
                {t('beans.blend.empty')}
                <br />
                {t('beans.blend.addBlendFirst')}
            </div>
            <SurfaceButton onClick={onAdd} icon={<Plus size={14} strokeWidth={2} />} className="px-4 py-2">
                {t('beans.blend.addBlend')}
            </SurfaceButton>
        </div>
    );
};
