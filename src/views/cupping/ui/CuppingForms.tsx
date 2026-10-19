import {
    type CuppingFormSchema,
    cloneForm,
    type FormField,
    type FormFieldType,
    fieldType,
    formSchemaOrSca,
    isSliderField,
    MAX_FORM_FIELDS,
    parseFormSchema,
    SCA_V1_FORM,
    SIMPLE_5_FORM,
    SLIDER_SCALES,
    type SliderField,
    sliderScaleId,
    slugFieldKey,
    useCreateCuppingFormTemplate,
    useCuppingFormTemplates,
    useDeleteCuppingFormTemplate,
    useUpdateCuppingFormTemplate,
} from '@entities/cupping';
import type { CuppingFormTemplate } from '@shared/types/database.types';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { confirm } from '@tauri-apps/plugin-dialog';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type CuppingFormsProps = {
    userId: string;
    onBack: () => void;
};

type EditorState = {
    id: string | null;
    name: string;
    fields: FormField[];
    scoring: CuppingFormSchema['scoring'];
};

const blankField = (used: Set<string>, label: string): FormField => ({
    key: slugFieldKey(label, used),
    label,
    type: 'slider',
    min: 0,
    max: 10,
    step: 0.25,
});

function retargetField(field: FormField, type: FormFieldType): FormField {
    const { key, label } = field;
    if (type === 'pass_fail') return { key, label, type: 'pass_fail' };
    if (type === 'select') {
        const options = field.type === 'select' ? field.options : ['Pass', 'Fail'];
        return { key, label, type: 'select', options };
    }
    if (isSliderField(field)) return { ...field, type: 'slider' };
    return { key, label, type: 'slider', min: 0, max: 10, step: 0.25 };
}

function applyScale(field: SliderField, id: string): SliderField {
    const preset = SLIDER_SCALES.find((s) => s.id === id);
    if (!preset) return field;
    return { ...field, type: 'slider', min: preset.min, max: preset.max, step: preset.step };
}

export const CuppingForms = ({ userId, onBack }: CuppingFormsProps) => {
    const { t } = useTranslation();
    const { data: templates = [], isLoading } = useCuppingFormTemplates(userId);
    const createForm = useCreateCuppingFormTemplate(userId);
    const updateForm = useUpdateCuppingFormTemplate(userId);
    const deleteForm = useDeleteCuppingFormTemplate(userId);
    const [editor, setEditor] = useState<EditorState | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    const openBlank = () => {
        setSaveError(null);
        setEditor({
            id: null,
            name: '',
            fields: [],
            scoring: { base: 0, defectWeight: 2 },
        });
    };

    const openClone = (source: CuppingFormSchema) => {
        const cloned = cloneForm(source, `${source.name}`);
        setSaveError(null);
        setEditor({ id: null, name: cloned.name, fields: cloned.fields, scoring: cloned.scoring });
    };

    const openExisting = (row: CuppingFormTemplate) => {
        const schema = formSchemaOrSca(row.schema);
        setSaveError(null);
        setEditor({ id: row.id, name: row.name, fields: schema.fields, scoring: schema.scoring });
    };

    const usedKeys = useMemo(() => new Set(editor?.fields.map((f) => f.key) ?? []), [editor]);

    const handleSave = async () => {
        if (!editor) return;
        setSaveError(null);
        try {
            const schema = parseFormSchema({
                v: 1,
                key: 'custom',
                name: editor.name.trim() || t('cupping.newForm'),
                fields: editor.fields,
                scoring: editor.scoring,
            });
            if (editor.id) {
                await updateForm.mutateAsync({ id: editor.id, name: schema.name, schema });
            } else {
                await createForm.mutateAsync({ name: schema.name, schema });
            }
            setEditor(null);
        } catch (e) {
            setSaveError(e instanceof Error ? e.message : t('cupping.formSaveFailed'));
        }
    };

    if (editor) {
        const pending = createForm.isPending || updateForm.isPending;
        return (
            <PageLayout>
                <button
                    type="button"
                    onClick={() => setEditor(null)}
                    className="mb-4 inline-flex items-center gap-1 border-none bg-transparent p-0 text-[13px] font-medium tracking-[0.14px] text-muted cursor-pointer transition-colors hover:text-primary"
                >
                    <ChevronLeft size={14} strokeWidth={2} />
                    {t('cupping.forms')}
                </button>
                <PageHeader
                    title={editor.id ? editor.name : t('cupping.newForm')}
                    subtitle={t('cupping.formSnapshotHint')}
                    actions={
                        <button
                            type="button"
                            disabled={pending || editor.fields.length < 1}
                            onClick={() => void handleSave()}
                            className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-full border-none bg-action px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-on-action transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {pending ? t('cupping.savingForm') : t('cupping.saveForm')}
                        </button>
                    }
                />
                <label className="mb-5 flex max-w-md flex-col gap-1 text-[12px] text-muted">
                    {t('cupping.formName')}
                    <input
                        value={editor.name}
                        onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                        placeholder={t('cupping.formNamePlaceholder')}
                        className="rounded-md border border-border-subtle bg-main-bg px-3 py-2 text-[13px] text-primary dark:border-border"
                    />
                </label>
                <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-main-bg dark:border-border">
                    <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3 dark:border-border">
                        <p className="text-[13px] font-semibold text-primary">{t('cupping.formFields')}</p>
                        <button
                            type="button"
                            disabled={editor.fields.length >= MAX_FORM_FIELDS}
                            onClick={() => {
                                const label = t('cupping.fieldDefault', { n: editor.fields.length + 1 });
                                setEditor({
                                    ...editor,
                                    fields: [...editor.fields, blankField(usedKeys, label)],
                                });
                            }}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-transparent bg-main-bg px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-secondary transition hover:bg-surface-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 dark:bg-surface-elevated dark:text-primary"
                        >
                            <Plus size={14} strokeWidth={2} />
                            {t('cupping.addField')}
                        </button>
                    </div>
                    {editor.fields.length === 0 ? (
                        <p className="px-4 py-10 text-center text-[13px] leading-relaxed text-muted">
                            {t('cupping.formFieldsEmpty')}
                        </p>
                    ) : (
                        <ul className="min-h-0 max-h-[min(28rem,calc(100vh-22rem))] divide-y divide-border-subtle overflow-y-auto [-webkit-overflow-scrolling:touch] dark:divide-[#585d61]">
                            {editor.fields.map((field, i) => {
                                const kind = fieldType(field);
                                const patch = (next: FormField) => {
                                    const fields = editor.fields.slice();
                                    fields[i] = next;
                                    setEditor({ ...editor, fields });
                                };
                                return (
                                    <li key={field.key} className="flex flex-col gap-2 px-4 py-3">
                                        <div className="grid grid-cols-[7.5rem_1fr_2rem] items-end gap-2">
                                            <label className="flex flex-col gap-1 text-[11px] text-muted">
                                                {t('cupping.fieldType')}
                                                <select
                                                    value={kind}
                                                    onChange={(e) =>
                                                        patch(retargetField(field, e.target.value as FormFieldType))
                                                    }
                                                    className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 text-[13px] text-primary dark:border-border"
                                                >
                                                    <option value="slider">{t('cupping.fieldTypeSlider')}</option>
                                                    <option value="pass_fail">{t('cupping.fieldTypePassFail')}</option>
                                                    <option value="select">{t('cupping.fieldTypeSelect')}</option>
                                                </select>
                                            </label>
                                            <label className="flex flex-col gap-1 text-[11px] text-muted">
                                                {t('cupping.fieldLabel')}
                                                <input
                                                    value={field.label}
                                                    onChange={(e) => patch({ ...field, label: e.target.value })}
                                                    className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 text-[13px] text-primary dark:border-border"
                                                />
                                            </label>
                                            <button
                                                type="button"
                                                aria-label={t('cupping.deleteForm')}
                                                onClick={() =>
                                                    setEditor({
                                                        ...editor,
                                                        fields: editor.fields.filter((_, j) => j !== i),
                                                    })
                                                }
                                                className="mb-0.5 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-red-50 hover:text-red-600"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                        {isSliderField(field) ? (
                                            <div className="grid grid-cols-[10rem_4.5rem_4.5rem_4.5rem] items-end gap-2">
                                                <label className="flex flex-col gap-1 text-[11px] text-muted">
                                                    {t('cupping.fieldScale')}
                                                    <select
                                                        value={sliderScaleId(field)}
                                                        onChange={(e) => {
                                                            const id = e.target.value;
                                                            if (id === 'custom') {
                                                                patch({ ...field, type: 'slider' });
                                                                return;
                                                            }
                                                            patch(applyScale(field, id));
                                                        }}
                                                        className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 text-[13px] text-primary dark:border-border"
                                                    >
                                                        <option value="sca">{t('cupping.scaleSca')}</option>
                                                        <option value="five">{t('cupping.scaleFive')}</option>
                                                        <option value="stars">{t('cupping.scaleStars')}</option>
                                                        <option value="custom">{t('cupping.scaleCustom')}</option>
                                                    </select>
                                                </label>
                                                <label className="flex flex-col gap-1 text-[11px] text-muted">
                                                    {t('cupping.fieldMin')}
                                                    <input
                                                        type="number"
                                                        value={field.min}
                                                        onChange={(e) =>
                                                            patch({
                                                                ...field,
                                                                type: 'slider',
                                                                min: Number(e.target.value),
                                                            })
                                                        }
                                                        className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 font-mono text-[13px] text-primary dark:border-border"
                                                    />
                                                </label>
                                                <label className="flex flex-col gap-1 text-[11px] text-muted">
                                                    {t('cupping.fieldMax')}
                                                    <input
                                                        type="number"
                                                        value={field.max}
                                                        onChange={(e) =>
                                                            patch({
                                                                ...field,
                                                                type: 'slider',
                                                                max: Number(e.target.value),
                                                            })
                                                        }
                                                        className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 font-mono text-[13px] text-primary dark:border-border"
                                                    />
                                                </label>
                                                <label className="flex flex-col gap-1 text-[11px] text-muted">
                                                    {t('cupping.fieldStep')}
                                                    <input
                                                        type="number"
                                                        step={0.05}
                                                        value={field.step}
                                                        onChange={(e) =>
                                                            patch({
                                                                ...field,
                                                                type: 'slider',
                                                                step: Number(e.target.value),
                                                            })
                                                        }
                                                        className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 font-mono text-[13px] text-primary dark:border-border"
                                                    />
                                                </label>
                                            </div>
                                        ) : null}
                                        {field.type === 'select' ? (
                                            <label className="flex flex-col gap-1 text-[11px] text-muted">
                                                {t('cupping.fieldOptions')}
                                                <input
                                                    value={field.options.join(', ')}
                                                    onChange={(e) =>
                                                        patch({
                                                            ...field,
                                                            type: 'select',
                                                            options: e.target.value
                                                                .split(',')
                                                                .map((s) => s.trim())
                                                                .filter(Boolean)
                                                                .slice(0, 8),
                                                        })
                                                    }
                                                    placeholder={t('cupping.fieldOptionsPlaceholder')}
                                                    className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 text-[13px] text-primary dark:border-border"
                                                />
                                            </label>
                                        ) : null}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
                <p className="mt-2 text-[12px] text-muted">{t('cupping.fieldNonScoreHint')}</p>
                {editor.fields.length >= MAX_FORM_FIELDS ? (
                    <p className="mt-2 text-[12px] text-muted">{t('cupping.maxFields')}</p>
                ) : null}
                {saveError ? <p className="mt-3 text-xs text-red-600">{saveError}</p> : null}
            </PageLayout>
        );
    }

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
                        onClick={openBlank}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-none bg-action px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-on-action transition hover:opacity-85"
                    >
                        <Plus size={14} strokeWidth={2} />
                        {t('cupping.newForm')}
                    </button>
                </div>
                {isLoading ? (
                    <p className="text-[12px] text-muted">{t('cupping.loading')}</p>
                ) : templates.length === 0 ? (
                    <p className="rounded-2xl border border-border px-4 py-8 text-center text-[13px] text-muted dark:border-border">
                        {t('cupping.formsEmpty')}
                    </p>
                ) : (
                    <div className="overflow-hidden rounded-2xl border border-border bg-main-bg dark:border-border">
                        {templates.map((row) => {
                            const schema = formSchemaOrSca(row.schema);
                            return (
                                <div
                                    key={row.id}
                                    className="flex items-center justify-between border-b border-border-subtle px-4 py-3 last:border-b-0 dark:border-border"
                                >
                                    <button
                                        type="button"
                                        onClick={() => openExisting(row)}
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
                                                deleteForm.reset();
                                                void deleteForm.mutateAsync(row.id);
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
                <div className="overflow-hidden rounded-2xl border border-border bg-main-bg dark:border-border">
                    {[SCA_V1_FORM, SIMPLE_5_FORM].map((preset) => (
                        <div
                            key={preset.key}
                            className="flex items-center justify-between border-b border-border-subtle px-4 py-3 last:border-b-0 dark:border-border"
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
                                onClick={() => openClone(preset)}
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-transparent bg-main-bg px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-secondary transition hover:bg-surface-hover hover:text-primary dark:bg-surface-elevated dark:text-primary"
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
