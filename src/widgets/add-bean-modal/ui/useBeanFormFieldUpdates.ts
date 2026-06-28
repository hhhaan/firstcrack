import { buildAutoName } from '@entities/bean/lib/coffee-origins';
import type { UseFormGetValues, UseFormSetValue } from 'react-hook-form';
import type { BeanForm } from '../lib/schema';

export const useBeanFormFieldUpdates = (
    setValue: UseFormSetValue<BeanForm>,
    getValues: UseFormGetValues<BeanForm>,
    nameIsAuto: boolean,
) => {
    const updateOrigin = (origin: string) => {
        const v = getValues();
        const newOrigin = v.origin === origin ? '' : origin;
        setValue('origin', newOrigin);
        setValue('region', '');
        setValue('farm', '');
        setValue('variety', '');
        if (nameIsAuto) {
            setValue('name', buildAutoName(newOrigin, '', '', ''));
        }
    };

    const updateRegion = (region: string) => {
        const v = getValues();
        const newRegion = v.region === region ? '' : region;
        setValue('region', newRegion);
        setValue('farm', '');
        if (nameIsAuto) {
            setValue('name', buildAutoName(v.origin, newRegion, '', v.variety));
        }
    };

    const updateFarm = (farm: string) => {
        const v = getValues();
        const newFarm = v.farm === farm ? '' : farm;
        setValue('farm', newFarm);
        if (nameIsAuto) {
            setValue('name', buildAutoName(v.origin, v.region, newFarm, v.variety));
        }
    };

    const updateVariety = (variety: string) => {
        const v = getValues();
        const newVariety = v.variety === variety ? '' : variety;
        setValue('variety', newVariety);
        if (nameIsAuto) {
            setValue('name', buildAutoName(v.origin, v.region, v.farm, newVariety));
        }
    };

    const updateProcess = (process: string) => {
        const v = getValues();
        setValue('process', v.process === process ? '' : process);
    };

    return { updateOrigin, updateRegion, updateFarm, updateVariety, updateProcess };
};
