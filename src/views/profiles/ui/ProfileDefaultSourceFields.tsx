import type { Bean } from '@shared/types/database.types';
import { chipCls, inputCls, labelCls } from '@shared/ui/form-styles';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProfileDefaultType } from '../lib/types';

type BlendOption = { id: string; name: string };

type ProfileDefaultSourceFieldsProps = {
    beans: Bean[];
    blends: BlendOption[];
    defaultType: ProfileDefaultType;
    setDefaultType: (t: ProfileDefaultType) => void;
    defaultBeanId: string | null;
    setDefaultBeanId: (id: string | null) => void;
    defaultBlendId: string | null;
    setDefaultBlendId: (id: string | null) => void;
};

const selectCls = `${inputCls} appearance-none cursor-pointer`;

export const ProfileDefaultSourceFields = ({
    beans,
    blends,
    defaultType,
    setDefaultType,
    defaultBeanId,
    setDefaultBeanId,
    defaultBlendId,
    setDefaultBlendId,
}: ProfileDefaultSourceFieldsProps) => {
    const { t } = useTranslation();

    return (
        <div className="border-t border-black/4 dark:border-[#585d61] pt-6">
            <label className={labelCls}>{t('newProfileModal.defaultBean')}</label>
            <div className="flex gap-2 mt-2">
                {(
                    [
                        ['none', t('newProfileModal.none')],
                        ['bean', t('newProfileModal.singleOrigin')],
                        ['blend', t('newProfileModal.blend')],
                    ] as const
                ).map(([type, label]) => (
                    <button
                        key={type}
                        type="button"
                        onClick={() => setDefaultType(type)}
                        className={chipCls(defaultType === type)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            {defaultType === 'bean' && (
                <div className="relative mt-3">
                    <select
                        value={defaultBeanId ?? ''}
                        onChange={(e) => setDefaultBeanId(e.target.value || null)}
                        className={selectCls}
                        style={{ paddingRight: '2.5rem' }}
                    >
                        <option value="">{t('newProfileModal.selectBeanOption')}</option>
                        {beans.map((b) => (
                            <option key={b.id} value={b.id}>
                                {b.name}
                            </option>
                        ))}
                    </select>
                    <ChevronDown
                        size={16}
                        strokeWidth={2.5}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    />
                </div>
            )}
            {defaultType === 'blend' && (
                <div className="relative mt-3">
                    <select
                        value={defaultBlendId ?? ''}
                        onChange={(e) => setDefaultBlendId(e.target.value || null)}
                        className={selectCls}
                        style={{ paddingRight: '2.5rem' }}
                    >
                        <option value="">{t('newProfileModal.selectBlendOption')}</option>
                        {blends.map((b) => (
                            <option key={b.id} value={b.id}>
                                {b.name}
                            </option>
                        ))}
                    </select>
                    <ChevronDown
                        size={16}
                        strokeWidth={2.5}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    />
                </div>
            )}
        </div>
    );
};
