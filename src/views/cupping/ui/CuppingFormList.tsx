import { type CuppingFormSchema, formSchemaOrSca, SCA_V1_FORM, SIMPLE_5_FORM } from '@entities/cupping';
import type { CuppingFormTemplate } from '@shared/types/database.types';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { confirm } from '@tauri-apps/plugin-dialog';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type CuppingFormListProps = {
    templates: CuppingFormTemplate[];
    isLoading: boolean;
    onBack: () => void;
    onNew: () => void;
    onOpen: (row: CuppingFormTemplate) => void;
    onClonePreset: (source: CuppingFormSchema) => void;
    onDelete: (row: CuppingFormTemplate) => void;
};

export const CuppingFormList = ({
    templates,
    isLoading,
    onBack,
    onNew,
    onOpen,
    onClonePreset,
    onDelete,
}: CuppingFormListProps) => {
    const { t } = useTranslation();

    return (
        <PageLayout>
            <button
                type="button"
                onClick={onBack}
                className="mb-4 inline-flex items-center gap-1 border-none bg-transparent p-0 text-[13px] font-medium tracking-[0.14px] text-muted cursor-pointer transition-colors hover:text-primary"
            >
                <ChevronLeft size={14} strokeWidth={2} />
                {t('cupping.formsBack')}
            </button>
            <PageHeader title={t('cupping.forms')} subtitle={t('cupping.formsSubtitle', { count: templates.length })} />

            <section className="mb-6">
                <div className="mb-2 flex items-center justify-between">
                    <p className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                        {t('cupping.presetCustom')}
                    </p>
                    <button
                        type="button"
                        onClick={onNew}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-none bg-primary px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-white transition hover:-translate-y-px dark:bg-[#0d0d0d]"
                    >
                        <Plus size={14} strokeWidth={2} />
                        {t('cupping.newForm')}
                    </button>
                </div>
                {isLoading ? (
                    <p className="text-[12px] text-muted">{t('cupping.loading')}</p>
                ) : templates.length === 0 ? (
                    <p className="rounded-xl border border-border-subtle px-4 py-8 text-center text-[13px] text-muted dark:border-[#585d61]">
                        {t('cupping.formsEmpty')}
                    </p>
                ) : (
                    <div className="overflow-hidden rounded-xl border border-border-subtle bg-main-bg dark:border-[#585d61]">
                        {templates.map((row) => {
                            const schema = formSchemaOrSca(row.schema);
                            return (
                                <div
                                    key={row.id}
                                    className="flex items-center justify-between border-b border-border-subtle px-4 py-3 last:border-b-0 dark:border-[#585d61]"
                                >
                                    <button
                                        type="button"
                                        onClick={() => onOpen(row)}
                                        className="min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-left"
                                    >
                                        <p className="text-[13px] font-medium text-primary">{row.name}</p>
                                        <p className="text-[12px] text-muted">{schema.fields.length}</p>
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={t('cupping.deleteForm')}
                                        onClick={async () => {
                                            if (await confirm(t('cupping.deleteFormConfirm', { name: row.name }))) {
                                                onDelete(row);
                                            }
                                        }}
                                        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-red-50 hover:text-red-600"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            <section>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                    {t('cupping.systemPreset')}
                </p>
                <div className="overflow-hidden rounded-xl border border-border-subtle bg-main-bg dark:border-[#585d61]">
                    {[SCA_V1_FORM, SIMPLE_5_FORM].map((preset) => (
                        <div
                            key={preset.key}
                            className="flex items-center justify-between border-b border-border-subtle px-4 py-3 last:border-b-0 dark:border-[#585d61]"
                        >
                            <div>
                                <p className="text-[13px] font-medium text-primary">
                                    {preset.key === 'sca_v1' ? t('cupping.presetSca') : t('cupping.presetSimple5')}
                                </p>
                                <p className="text-[12px] text-muted">
                                    {preset.fields.length} · {preset.scoring.base}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onClonePreset(preset)}
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-transparent bg-main-bg px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-secondary transition hover:-translate-y-px hover:text-primary dark:bg-[#262b31] dark:text-[#e5e5e5]"
                            >
                                {t('cupping.cloneForm')}
                            </button>
                        </div>
                    ))}
                </div>
            </section>
        </PageLayout>
    );
};
