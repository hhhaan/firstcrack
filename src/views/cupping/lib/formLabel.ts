import { formSchemaOrSca } from '@entities/cupping';

export function eventFormLabel(snapshot: unknown, t: (key: string) => string): string {
    const schema = formSchemaOrSca(snapshot);
    if (schema.key === 'sca_v1') return t('cupping.presetSca');
    if (schema.key === 'simple_5') return t('cupping.presetSimple5');
    return schema.name;
}
