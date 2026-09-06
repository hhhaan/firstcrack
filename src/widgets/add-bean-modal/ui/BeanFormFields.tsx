import {
    COMMON_ORIGINS,
    COMMON_PROCESSES,
    FARMS_BY_REGION,
    REGIONS_BY_ORIGIN,
    VARIETIES_BY_ORIGIN,
} from '@entities/bean/lib/coffee-origins';
import { FormField } from '@shared/ui/form-field/FormField';
import { chipCls, labelCls } from '@shared/ui/form-styles';
import { numericInputProps } from '@shared/ui/numeric-input';
import { Info, MapPin, Scale, Tag } from 'lucide-react';
import type { FieldErrors, UseFormGetValues, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { BeanForm } from '../lib/schema';
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
        <form
            id="bean-form"
            data-testid="bean-form"
            onSubmit={handleSubmit(onSubmit)}
            className="grid grid-cols-2 gap-6"
        >
            <FormField.Root className="col-span-2" error={errors.name?.message}>
                <FormField.Label>
                    <Info size={14} /> {t('addBeanModal.form.lotName')}
                </FormField.Label>
                <FormField.Control>
                    <input
                        data-testid="bean-form-name"
                        placeholder={t('addBeanModal.form.lotNamePlaceholder')}
                        {...register('name', { onChange: () => setNameIsAuto(false) })}
                    />
                </FormField.Control>
                <FormField.ErrorMessage />
            </FormField.Root>

            <FormField.Root>
                <FormField.Label>
                    <MapPin size={14} /> {t('addBeanModal.form.origin')}
                </FormField.Label>
                <FormField.Control>
                    <input placeholder={t('addBeanModal.form.originPlaceholder')} {...register('origin')} />
                </FormField.Control>
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
            </FormField.Root>

            <FormField.Root>
                <FormField.Label>
                    <MapPin size={14} /> {t('addBeanModal.form.region')}
                </FormField.Label>
                <FormField.Control>
                    <input placeholder={t('addBeanModal.form.regionPlaceholder')} {...register('region')} />
                </FormField.Control>
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
            </FormField.Root>

            <FormField.Root>
                <FormField.Label>
                    <MapPin size={14} /> {t('addBeanModal.form.farm')}
                </FormField.Label>
                <FormField.Control>
                    <input placeholder={t('addBeanModal.form.farmPlaceholder')} {...register('farm')} />
                </FormField.Control>
                {origin && region && FARMS_BY_REGION[region] && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {FARMS_BY_REGION[region].slice(0, 5).map((f: string) => (
                            <button key={f} type="button" onClick={() => updateFarm(f)} className={chipCls(farm === f)}>
                                {f}
                            </button>
                        ))}
                    </div>
                )}
            </FormField.Root>

            <FormField.Root>
                <FormField.Label>
                    <Info size={14} /> {t('addBeanModal.form.variety')}
                </FormField.Label>
                <FormField.Control>
                    <input placeholder={t('addBeanModal.form.varietyPlaceholder')} {...register('variety')} />
                </FormField.Control>
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
            </FormField.Root>

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

            <FormField.Root>
                <FormField.Label>
                    <MapPin size={14} /> {t('addBeanModal.form.altitude')}
                </FormField.Label>
                <FormField.Control>
                    <input
                        {...numericInputProps}
                        placeholder={t('addBeanModal.form.altitudePlaceholder')}
                        value={altitude}
                        onChange={(e) => setValue('altitude', e.target.value.replace(/\D/g, ''))}
                    />
                </FormField.Control>
            </FormField.Root>

            <FormField.Root>
                <FormField.Label>
                    <Scale size={14} /> {t('addBeanModal.form.stock')}
                </FormField.Label>
                <FormField.Control>
                    <input
                        {...numericInputProps}
                        data-testid="bean-form-stock"
                        placeholder="5"
                        value={stock}
                        onChange={(e) => setValue('stock', e.target.value.replace(/[^0-9.]/g, ''))}
                    />
                </FormField.Control>
            </FormField.Root>

            <FormField.Root>
                <FormField.Label>
                    <Scale size={14} /> {t('addBeanModal.form.capacity')}
                </FormField.Label>
                <FormField.Control>
                    <input
                        {...numericInputProps}
                        placeholder="5"
                        value={capacity}
                        onChange={(e) => setValue('capacity', e.target.value.replace(/[^0-9.]/g, ''))}
                    />
                </FormField.Control>
            </FormField.Root>

            <FormField.Root>
                <FormField.Label>
                    <Scale size={14} /> {t('addBeanModal.form.cost')}
                </FormField.Label>
                <FormField.Control>
                    <input
                        {...numericInputProps}
                        placeholder={t('addBeanModal.form.costPlaceholder')}
                        value={costPerKg}
                        onChange={(e) => setValue('costPerKg', e.target.value.replace(/[^0-9.]/g, ''))}
                    />
                </FormField.Control>
            </FormField.Root>

            <FormField.Root className="col-span-2">
                <FormField.Label>
                    <Info size={14} /> {t('addBeanModal.form.tastingNotes')}
                </FormField.Label>
                <FormField.Control>
                    <textarea
                        className="min-h-25 resize-none"
                        placeholder={t('addBeanModal.form.tastingNotesPlaceholder')}
                        {...register('tastingNotes')}
                    />
                </FormField.Control>
            </FormField.Root>
        </form>
    );
};
