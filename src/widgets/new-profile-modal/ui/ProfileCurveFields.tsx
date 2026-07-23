import { inputCls, labelCls } from '@shared/ui/form-styles';
import { useTranslation } from 'react-i18next';
import { numericInputProps } from '../lib/numeric-input';
import type { ProfileFormState } from '../lib/types';

type ProfileCurveFieldsProps = {
    form: ProfileFormState;
    setField: (
        field: keyof ProfileFormState,
    ) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
};

/** Charge/drop temp, duration, development time & % — profile curve params */
export const ProfileCurveFields = ({ form, setField }: ProfileCurveFieldsProps) => {
    const { t } = useTranslation();

    return (
        <>
            {/* Charge Temp / Drop Temp */}
            <div className="grid grid-cols-2 gap-6">
                <div>
                    <label className={labelCls}>{t('newProfileModal.chargeTemp')}</label>
                    <input
                        {...numericInputProps}
                        className={inputCls}
                        placeholder={t('newProfileModal.tempPlaceholder')}
                        value={form.charge_temp_celsius}
                        onChange={setField('charge_temp_celsius')}
                    />
                </div>
                <div>
                    <label className={labelCls}>{t('newProfileModal.dropTemp')}</label>
                    <input
                        {...numericInputProps}
                        className={inputCls}
                        placeholder={t('newProfileModal.tempPlaceholder')}
                        value={form.drop_temp_celsius}
                        onChange={setField('drop_temp_celsius')}
                    />
                </div>
            </div>

            {/* Duration / Dev Time / Dev % */}
            <div className="grid grid-cols-3 gap-6">
                <div>
                    <label className={labelCls}>{t('newProfileModal.duration')}</label>
                    <input
                        {...numericInputProps}
                        className={inputCls}
                        placeholder={t('newProfileModal.durationPlaceholder')}
                        value={form.duration_sec}
                        onChange={setField('duration_sec')}
                    />
                </div>
                <div>
                    <label className={labelCls}>{t('newProfileModal.devTime')}</label>
                    <input
                        {...numericInputProps}
                        className={inputCls}
                        placeholder={t('newProfileModal.devTimePlaceholder')}
                        value={form.dev_time_sec}
                        onChange={setField('dev_time_sec')}
                    />
                </div>
                <div>
                    <label className={labelCls}>{t('newProfileModal.devPct')}</label>
                    <input
                        type="number"
                        className={inputCls}
                        placeholder={t('newProfileModal.devPctPlaceholder')}
                        value={form.dev_pct}
                        onChange={setField('dev_pct')}
                        min={0}
                        max={100}
                        step={0.1}
                    />
                </div>
            </div>
        </>
    );
};
