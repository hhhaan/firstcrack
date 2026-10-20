import {
    type CuppingFormSchema,
    type FormField,
    type FormFieldType,
    fieldType,
    isSliderField,
    MAX_FORM_FIELDS,
    SLIDER_SCALES,
    type SliderField,
    sliderScaleId,
    slugFieldKey,
} from '@entities/cupping';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export type CuppingFormEditorState = {
    id: string | null;
    name: string;
    fields: FormField[];
    scoring: CuppingFormSchema['scoring'];
};

type CuppingFormEditorProps = {
    editor: CuppingFormEditorState;
    onChange: (next: CuppingFormEditorState) => void;
    onCancel: () => void;
    onSave: () => void;
    pending: boolean;
    saveError: string | null;
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

function finiteInputNumber(el: HTMLInputElement): number | undefined {
    const n = el.valueAsNumber;
    return Number.isFinite(n) ? n : undefined;
}

type FieldRowProps = {
    field: FormField;
    onPatch: (next: FormField) => void;
    onRemove: () => void;
};

const CuppingFormFieldRow = ({ field, onPatch, onRemove }: FieldRowProps) => {
    const { t } = useTranslation();
    const kind = fieldType(field);

    return (
        <li className="flex flex-col gap-2 px-4 py-3">
            <div className="grid grid-cols-[7.5rem_1fr_2rem] items-end gap-2">
                <label className="flex flex-col gap-1 text-[11px] text-muted">
                    {t('cupping.fieldType')}
                    <select
                        value={kind}
                        onChange={(e) => onPatch(retargetField(field, e.target.value as FormFieldType))}
                        className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 text-[13px] text-primary dark:border-[#585d61]"
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
                        onChange={(e) => onPatch({ ...field, label: e.target.value })}
                        className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 text-[13px] text-primary dark:border-[#585d61]"
                    />
                </label>
                <button
                    type="button"
                    aria-label={t('cupping.deleteForm')}
                    onClick={onRemove}
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
                                    onPatch({ ...field, type: 'slider' });
                                    return;
                                }
                                onPatch(applyScale(field, id));
                            }}
                            className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 text-[13px] text-primary dark:border-[#585d61]"
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
                            onChange={(e) => {
                                const min = finiteInputNumber(e.currentTarget);
                                if (min === undefined) return;
                                onPatch({ ...field, type: 'slider', min });
                            }}
                            className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 font-mono text-[13px] text-primary dark:border-[#585d61]"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-muted">
                        {t('cupping.fieldMax')}
                        <input
                            type="number"
                            value={field.max}
                            onChange={(e) => {
                                const max = finiteInputNumber(e.currentTarget);
                                if (max === undefined) return;
                                onPatch({ ...field, type: 'slider', max });
                            }}
                            className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 font-mono text-[13px] text-primary dark:border-[#585d61]"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-muted">
                        {t('cupping.fieldStep')}
                        <input
                            type="number"
                            step={0.05}
                            value={field.step}
                            onChange={(e) => {
                                const step = finiteInputNumber(e.currentTarget);
                                if (step === undefined) return;
                                onPatch({ ...field, type: 'slider', step });
                            }}
                            className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 font-mono text-[13px] text-primary dark:border-[#585d61]"
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
                            onPatch({
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
                        className="rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 text-[13px] text-primary dark:border-[#585d61]"
                    />
                </label>
            ) : null}
        </li>
    );
};

export const CuppingFormEditor = ({
    editor,
    onChange,
    onCancel,
    onSave,
    pending,
    saveError,
}: CuppingFormEditorProps) => {
    const { t } = useTranslation();
    const usedKeys = useMemo(() => new Set(editor.fields.map((f) => f.key)), [editor.fields]);

    const patchField = (index: number, next: FormField) => {
        const fields = editor.fields.slice();
        fields[index] = next;
        onChange({ ...editor, fields });
    };

    return (
        <PageLayout>
            <button
                type="button"
                onClick={onCancel}
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
                        onClick={onSave}
                        className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-full border-none bg-primary px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-white transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#0d0d0d]"
                    >
                        {pending ? t('cupping.savingForm') : t('cupping.saveForm')}
                    </button>
                }
            />
            <label className="mb-5 flex max-w-md flex-col gap-1 text-[12px] text-muted">
                {t('cupping.formName')}
                <input
                    value={editor.name}
                    onChange={(e) => onChange({ ...editor, name: e.target.value })}
                    placeholder={t('cupping.formNamePlaceholder')}
                    className="rounded-md border border-border-subtle bg-main-bg px-3 py-2 text-[13px] text-primary dark:border-[#585d61]"
                />
            </label>
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border-subtle bg-main-bg dark:border-[#585d61]">
                <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3 dark:border-[#585d61]">
                    <p className="text-[13px] font-semibold text-primary">{t('cupping.formFields')}</p>
                    <button
                        type="button"
                        disabled={editor.fields.length >= MAX_FORM_FIELDS}
                        onClick={() => {
                            const label = t('cupping.fieldDefault', { n: editor.fields.length + 1 });
                            onChange({
                                ...editor,
                                fields: [...editor.fields, blankField(usedKeys, label)],
                            });
                        }}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-transparent bg-main-bg px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-secondary transition hover:-translate-y-px hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#262b31] dark:text-[#e5e5e5]"
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
                        {editor.fields.map((field, i) => (
                            <CuppingFormFieldRow
                                key={field.key}
                                field={field}
                                onPatch={(next) => patchField(i, next)}
                                onRemove={() =>
                                    onChange({
                                        ...editor,
                                        fields: editor.fields.filter((_, j) => j !== i),
                                    })
                                }
                            />
                        ))}
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
};
