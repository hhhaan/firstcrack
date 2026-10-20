import {
    type CuppingFormSchema,
    cloneForm,
    formSchemaOrSca,
    parseFormSchema,
    useCreateCuppingFormTemplate,
    useCuppingFormTemplates,
    useDeleteCuppingFormTemplate,
    useUpdateCuppingFormTemplate,
} from '@entities/cupping';
import type { CuppingFormTemplate } from '@shared/types/database.types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CuppingFormEditor, type CuppingFormEditorState } from './CuppingFormEditor';
import { CuppingFormList } from './CuppingFormList';

type CuppingFormsProps = {
    userId: string;
    onBack: () => void;
};

export const CuppingForms = ({ userId, onBack }: CuppingFormsProps) => {
    const { t } = useTranslation();
    const { data: templates = [], isLoading } = useCuppingFormTemplates(userId);
    const createForm = useCreateCuppingFormTemplate(userId);
    const updateForm = useUpdateCuppingFormTemplate(userId);
    const deleteForm = useDeleteCuppingFormTemplate(userId);
    const [editor, setEditor] = useState<CuppingFormEditorState | null>(null);
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
        return (
            <CuppingFormEditor
                editor={editor}
                onChange={setEditor}
                onCancel={() => setEditor(null)}
                onSave={() => void handleSave()}
                pending={createForm.isPending || updateForm.isPending}
                saveError={saveError}
            />
        );
    }

    return (
        <CuppingFormList
            templates={templates}
            isLoading={isLoading}
            onBack={onBack}
            onNew={openBlank}
            onOpen={openExisting}
            onClonePreset={openClone}
            onDelete={(row) => {
                deleteForm.reset();
                void deleteForm.mutateAsync(row.id);
            }}
        />
    );
};
