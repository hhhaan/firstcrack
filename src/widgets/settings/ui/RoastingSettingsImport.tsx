import { FormSelect } from '@shared/ui/FormSelect';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { useTranslation } from 'react-i18next';
import { useRoastingSettingsImport } from '../model/useRoastingSettingsImport';
import { RoastingGraphPreview, RoastingMachinePreview } from './RoastingImportPreviews';
import { SettingsSection } from './SettingsSection';

type Translate = (key: string, options?: Record<string, string | number>) => string;
type ImportModel = ReturnType<typeof useRoastingSettingsImport>;

const importApplyLabel = (model: ImportModel, tk: Translate) => {
    if (model.applying) return tk('saving');
    if (model.selectedCount > 0) {
        return tk(model.includeGraph && model.hasGraph ? 'applyBoth' : 'applyMachines', { count: model.selectedCount });
    }
    return tk(model.includeGraph && model.hasGraph ? 'applyGraph' : 'apply');
};

function ImportProductField({ model, label }: { model: ImportModel; label: string }) {
    return (
        <label className="flex flex-wrap items-center gap-3 text-xs text-secondary">
            {label}
            <FormSelect
                value={model.product}
                disabled={!model.platformSupported || model.applying}
                wrapperClassName="w-40"
                className="h-8 py-1 text-xs"
                onChange={(event) => model.selectProduct(event.currentTarget.value as ImportModel['product'])}
            >
                <option value="Firescope">Firescope</option>
                <option value="Artisan">Artisan</option>
                <option value="Cropster">Cropster</option>
            </FormSelect>
        </label>
    );
}

function ImportScanStatus({ model, tk }: { model: ImportModel; tk: Translate }) {
    const { t } = useTranslation();
    let message = tk('searching');
    if (!model.platformSupported) message = t('settings.roastingImport.macosOnly');
    else if (model.query.isFetching) message = tk('searching');
    else if (model.query.error) message = tk('scanFailed');
    else if (model.snapshot) message = tk(`status.${model.snapshot.status}`);
    return (
        <p className="m-0 text-xs text-secondary" role="status">
            {message}
        </p>
    );
}

function ArtisanVersionConfirm({ model, tk }: { model: ImportModel; tk: Translate }) {
    if (!model.artisan || model.artisan.source.version !== null) return null;
    return (
        <label className="flex items-start gap-3 text-xs text-secondary">
            <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                checked={model.confirmedVersion !== null}
                disabled={model.applying}
                onChange={(event) => model.confirmVersion(event.currentTarget.checked)}
            />
            <span>{tk('confirmVersion')}</span>
        </label>
    );
}

function ImportApplyResult({ result, tk }: { result: ImportModel['result']; tk: Translate }) {
    if (!result) return null;
    const failed = result === 'failed' || result === 'graphSavedMachinesFailed';
    return (
        <p
            className={`m-0 text-xs ${failed ? 'text-phase-danger' : 'text-secondary'}`}
            role={failed ? 'alert' : 'status'}
        >
            {tk(result)}
        </p>
    );
}

function ImportFoundSettings({ model, tk }: { model: ImportModel; tk: Translate }) {
    const graph = model.graph;
    return (
        <>
            <ArtisanVersionConfirm model={model} tk={tk} />
            <div className="min-w-0 overflow-hidden rounded-xl border border-border">
                <div className="border-b border-border-subtle px-4 py-3">
                    <h3 className="m-0 text-[13px] font-medium text-primary">{tk('machineHeading')}</h3>
                    <p className="mb-0 mt-1 text-xs text-muted">{tk('machineHint')}</p>
                </div>
                <div className="divide-y divide-border-subtle">
                    {model.candidates.map(({ sequence, current, connection, mapping, existing, update }) => (
                        <RoastingMachinePreview
                            key={sequence}
                            current={current}
                            connection={connection}
                            mapping={mapping}
                            imported={Boolean(existing) && !update}
                            updateAvailable={Boolean(update)}
                            selected={model.selectedIds.has(sequence)}
                            disabled={model.applying}
                            onSelectedChange={(checked) => model.selectMachine(sequence, checked)}
                            tk={tk}
                        />
                    ))}
                    {model.candidates.length === 0 && <p className="m-0 p-4 text-xs text-muted">{tk('noMachines')}</p>}
                </div>
            </div>
            {graph && graph.fields.length > 0 && (
                <RoastingGraphPreview
                    graph={graph}
                    previous={model.roastSettings}
                    checked={model.includeGraph}
                    hasGraph={model.hasGraph}
                    unit={model.unit}
                    disabled={model.applying}
                    onCheckedChange={model.setIncludeGraph}
                    onUnitChange={model.setUnitOverride}
                    unitEditable={model.product === 'Firescope'}
                    tk={tk}
                />
            )}
            <p className="m-0 text-xs text-muted">{tk('applyNote')}</p>
            {!model.withinLimit && (
                <p className="m-0 text-xs text-secondary" role="alert">
                    {tk('planLimit')}
                </p>
            )}
            <PillButton
                type="button"
                disabled={!model.canApply}
                className="justify-center disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void model.apply()}
            >
                {importApplyLabel(model, tk)}
            </PillButton>
        </>
    );
}

export function RoastingSettingsImport() {
    const { t } = useTranslation();
    const model = useRoastingSettingsImport();
    const tk = (key: string, options?: Record<string, string | number>) =>
        t([`settings.${model.product.toLowerCase()}.${key}`, `settings.firescope.${key}`], options);
    const found = model.platformSupported && model.snapshot?.status === 'found';

    return (
        <SettingsSection group="import">
            <SettingsSection.Header title={tk('title')} description={tk('description')} />
            <SettingsSection.Body className="grid gap-3">
                <ImportProductField model={model} label={t('settings.roastingImport.source')} />
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <ImportScanStatus model={model} tk={tk} />
                    <SurfaceButton disabled={!model.platformSupported || model.busy} onClick={model.rescan}>
                        {tk('rescan')}
                    </SurfaceButton>
                </div>
                {found && <ImportFoundSettings model={model} tk={tk} />}
                <ImportApplyResult result={model.result} tk={tk} />
            </SettingsSection.Body>
        </SettingsSection>
    );
}
