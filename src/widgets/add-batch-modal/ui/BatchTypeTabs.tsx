import { labelCls, tabCls } from '@shared/ui/form-styles';
import { useTranslation } from 'react-i18next';
import type { BatchType } from '../lib/types';

type Props = {
    batchType: BatchType;
    onBatchTypeChange: (type: BatchType) => void;
};

const BATCH_TYPES: BatchType[] = ['Single Origin', 'Pre-roast Blend', 'Post-roast Blend'];

export const BatchTypeTabs = ({ batchType, onBatchTypeChange }: Props) => {
    const { t } = useTranslation();

    return (
        <div>
            <label className={labelCls}>{t('addBatchModal.type')}</label>
            <div className="flex bg-surface p-1 rounded-2xl shadow-(--shadow-inset)">
                {BATCH_TYPES.map((bt) => (
                    <button
                        key={bt}
                        type="button"
                        onClick={() => onBatchTypeChange(bt)}
                        className={tabCls(batchType === bt)}
                    >
                        {bt === 'Single Origin'
                            ? t('addBatchModal.batchType.singleOrigin')
                            : bt === 'Pre-roast Blend'
                              ? t('addBatchModal.batchType.preRoastBlend')
                              : t('addBatchModal.batchType.postRoastBlend')}
                    </button>
                ))}
            </div>
        </div>
    );
};
