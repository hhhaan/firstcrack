import {
    COMMON_ORIGINS,
    COMMON_PROCESSES,
    FARMS_BY_REGION,
    REGIONS_BY_ORIGIN,
    VARIETIES_BY_ORIGIN,
} from '@entities/bean/lib/coffee-origins';
import { Info, MapPin, Scale, Tag } from 'lucide-react';
import type { FieldErrors, UseFormGetValues, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { numericInputProps } from '../lib/numeric-input';
import type { BeanForm } from '../lib/schema';
import { chipCls, inputCls, labelCls } from '../lib/styles';
import { ChipGroup } from './ChipGroup';
import { useBeanFormFieldUpdates } from './useBeanFormFieldUpdates';

type Props = {
    register: UseFormRegister<BeanForm>;
    setValue: UseFormSetValue<BeanForm>;
    getValues: UseFormGetValues<BeanForm>;
    errors: FieldErrors<BeanForm>;
    nameIsAuto: boolean;
    setNameIsAuto: (v: boolean) => void;
    onSubmit: (data: BeanForm) => void;
    handleSubmit: (fn: (data: BeanForm) => void) => (e?: React.BaseSyntheticEvent) => Promise<void>;
};

export const BeanFormFields = ({
    register,
    setValue,
    getValues,
    errors,
    nameIsAuto,
    setNameIsAuto,
    onSubmit,
    handleSubmit,
}: Props) => {
    const { t } = useTranslation();
    const origin = useWatch({ name: 'origin' });
    const region = useWatch({ name: 'region' });
    const farm = useWatch({ name: 'farm' });
    const variety = useWatch({ name: 'variety' });
    const beanProcess = useWatch({ name: 'process' });
    const altitude = useWatch({ name: 'altitude' });
    const stock = useWatch({ name: 'stock' });
    const capacity = useWatch({ name: 'capacity' });
    const costPerKg = useWatch({ name: 'costPerKg' });

    const { updateOrigin, updateRegion, updateFarm, updateVariety, updateProcess } = useBeanFormFieldUpdates(
        setValue,
        getValues,
        nameIsAuto,
    );

    return (
        <form id="bean-form" onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-6">
            <div className="col-span-2">
                <label className={labelCls}>
                    <Info size={14} /> {t('addBeanModal.form.lotName')}
                </label>
                <input
                    className={inputCls}
                    placeholder={t('addBeanModal.form.lotNamePlaceholder')}
                    {...register('name', { onChange: () => setNameIsAuto(false) })}
                />
                {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name.message}</p>}
            </div>

            <div>
                <label className={labelCls}>
                    <MapPin size={14} /> {t('addBeanModal.form.origin')}
                </label>
                <input
                    className={inputCls}
                    placeholder={t('addBeanModal.form.originPlaceholder')}
                    {...register('origin')}
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                    <ChipGroup
                        items={[...COMMON_ORIGINS]}
                        renderItem={(country) => (
                            <button
                                key={country}
                                type="button"
                                onClick={() => updateOrigin(country)}
                                className={chipCls(origin === country)}
                            >
                                {country}
                            </button>
                        )}
                    />
                </div>
            </div>

            <div>
                <label className={labelCls}>
                    <MapPin size={14} /> {t('addBeanModal.form.region')}
                </label>
                <input
                    className={inputCls}
                    placeholder={t('addBeanModal.form.regionPlaceholder')}
                    {...register('region')}
                />
                {REGIONS_BY_ORIGIN[origin] && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {REGIONS_BY_ORIGIN[origin].map((r: string) => (
                            <button
                                key={r}
                                type="button"
                                onClick={() => updateRegion(r)}
                                className={chipCls(region === r)}
                            >
                                {r}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div>
                <label className={labelCls}>
                    <MapPin size={14} /> {t('addBeanModal.form.farm')}
                </label>
                <input
                    className={inputCls}
                    placeholder={t('addBeanModal.form.farmPlaceholder')}
                    {...register('farm')}
                />
                {origin && region && FARMS_BY_REGION[region] && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {FARMS_BY_REGION[region].slice(0, 5).map((f: string) => (
                            <button key={f} type="button" onClick={() => updateFarm(f)} className={chipCls(farm === f)}>
                                {f}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div>
                <label className={labelCls}>
                    <Info size={14} /> {t('addBeanModal.form.variety')}
                </label>
                <input
                    className={inputCls}
                    placeholder={t('addBeanModal.form.varietyPlaceholder')}
                    {...register('variety')}
                />
                {origin && VARIETIES_BY_ORIGIN[origin] && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        <ChipGroup
                            items={VARIETIES_BY_ORIGIN[origin]}
                            renderItem={(varietyName) => (
                                <button
                                    key={varietyName}
                                    type="button"
                                    onClick={() => updateVariety(varietyName)}
                                    className={chipCls(variety === varietyName)}
                                >
                                    {varietyName}
                                </button>
                            )}
                        />
                    </div>
                )}
            </div>

            <div>
                <label className={labelCls}>
                    <Tag size={14} /> {t('addBeanModal.form.process')}
                </label>
                <div className="flex flex-wrap gap-1.5">
                    <ChipGroup
                        items={COMMON_PROCESSES}
                        renderItem={(p) => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => updateProcess(p)}
                                className={chipCls(beanProcess === p)}
                            >
                                {p}
                            </button>
                        )}
                    />
                </div>
            </div>

            <div>
                <label className={labelCls}>
                    <MapPin size={14} /> {t('addBeanModal.form.altitude')}
                </label>
                <input
                    {...numericInputProps}
                    className={inputCls}
                    placeholder={t('addBeanModal.form.altitudePlaceholder')}
                    value={altitude}
                    onChange={(e) => setValue('altitude', e.target.value.replace(/\D/g, ''))}
                />
            </div>

            <div>
                <label className={labelCls}>
                    <Scale size={14} /> {t('addBeanModal.form.stock')}
                </label>
                <input
                    {...numericInputProps}
                    className={inputCls}
                    placeholder="5"
                    value={stock}
                    onChange={(e) => setValue('stock', e.target.value.replace(/[^0-9.]/g, ''))}
                />
            </div>

            <div>
                <label className={labelCls}>
                    <Scale size={14} /> {t('addBeanModal.form.capacity')}
                </label>
                <input
                    {...numericInputProps}
                    className={inputCls}
                    placeholder="5"
                    value={capacity}
                    onChange={(e) => setValue('capacity', e.target.value.replace(/[^0-9.]/g, ''))}
                />
            </div>

            <div>
                <label className={labelCls}>
                    <Scale size={14} /> {t('addBeanModal.form.cost')}
                </label>
                <input
                    {...numericInputProps}
                    className={inputCls}
                    placeholder={t('addBeanModal.form.costPlaceholder')}
                    value={costPerKg}
                    onChange={(e) => setValue('costPerKg', e.target.value.replace(/[^0-9.]/g, ''))}
                />
            </div>

            <div className="col-span-2">
                <label className={labelCls}>
                    <Info size={14} /> {t('addBeanModal.form.tastingNotes')}
                </label>
                <textarea
                    className={`${inputCls} min-h-25 resize-none`}
                    placeholder={t('addBeanModal.form.tastingNotesPlaceholder')}
                    {...register('tastingNotes')}
                />
            </div>
        </form>
    );
};
