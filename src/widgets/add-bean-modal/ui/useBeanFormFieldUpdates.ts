import { buildAutoName } from '@entities/bean/lib/coffee-origins';
import type { UseFormGetValues, UseFormSetValue } from 'react-hook-form';
import type { BeanForm } from '../lib/schema';

export const useBeanFormFieldUpdates = (
    setValue: UseFormSetValue<BeanForm>,
    getValues: UseFormGetValues<BeanForm>,
    nameIsAuto: boolean,
) => {
    const setAutoName = (origin: string, region: string, farm: string, variety: string) => {
        if (!nameIsAuto) return;
        const name = buildAutoName(origin, region, farm, variety);
        // ponytail: only revalidate when a value is present so emptying a chip
        // doesn't surface the required error before submit.
        setValue('name', name, { shouldValidate: name.length > 0 });
    };

    const updateOrigin = (origin: string) => {
        const v = getValues();
        const newOrigin = v.origin === origin ? '' : origin;
        setValue('origin', newOrigin);
        setValue('region', '');
        setValue('farm', '');
        setValue('variety', '');
        setAutoName(newOrigin, '', '', '');
    };

    const updateRegion = (region: string) => {
        const v = getValues();
        const newRegion = v.region === region ? '' : region;
        setValue('region', newRegion);
        setValue('farm', '');
        setAutoName(v.origin, newRegion, '', v.variety);
    };

    const updateFarm = (farm: string) => {
        const v = getValues();
        const newFarm = v.farm === farm ? '' : farm;
        setValue('farm', newFarm);
        setAutoName(v.origin, v.region, newFarm, v.variety);
    };

    const updateVariety = (variety: string) => {
        const v = getValues();
        const newVariety = v.variety === variety ? '' : variety;
        setValue('variety', newVariety);
        setAutoName(v.origin, v.region, v.farm, newVariety);
    };

    const updateProcess = (process: string) => {
        const v = getValues();
        setValue('process', v.process === process ? '' : process);
    };

    return { updateOrigin, updateRegion, updateFarm, updateVariety, updateProcess };
};
