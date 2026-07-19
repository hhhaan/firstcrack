import type { Bean } from '@shared/types/database.types';
import { FormSelect } from '@shared/ui/FormSelect';
import { chipCls, labelCls } from '@shared/ui/form-styles';
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
                <FormSelect
                    wrapperClassName="mt-3"
                    value={defaultBeanId ?? ''}
                    onChange={(e) => setDefaultBeanId(e.target.value || null)}
                >
                    <option value="">{t('newProfileModal.selectBeanOption')}</option>
                    {beans.map((b) => (
                        <option key={b.id} value={b.id}>
                            {b.name}
                        </option>
                    ))}
                </FormSelect>
            )}
            {defaultType === 'blend' && (
                <FormSelect
                    wrapperClassName="mt-3"
                    value={defaultBlendId ?? ''}
                    onChange={(e) => setDefaultBlendId(e.target.value || null)}
                >
                    <option value="">{t('newProfileModal.selectBlendOption')}</option>
                    {blends.map((b) => (
                        <option key={b.id} value={b.id}>
                            {b.name}
                        </option>
                    ))}
                </FormSelect>
            )}
        </div>
    );
};
