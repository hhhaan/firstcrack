import { FormSelect } from '@shared/ui/FormSelect';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { useTranslation } from 'react-i18next';
import { useRoastingSettingsImport } from '../model/useRoastingSettingsImport';
import { RoastingGraphPreview, RoastingMachinePreview } from './RoastingImportPreviews';
import { SettingsSection } from './SettingsSection';

export function RoastingSettingsImport() {
    const { t } = useTranslation();
    const {
        product,
        confirmedVersion,
        query,
        snapshot,
        artisan,
        unit,
        graph,
        candidates,
        roastSettings,
        selectedIds,
        includeGraph,
        applying,
        result,
        busy,
        withinLimit,
        canApply,
        hasGraph,
        selectedCount,
        apply,
        selectProduct,
        rescan,
        confirmVersion,
        selectMachine,
        setIncludeGraph,
        setUnitOverride,
    } = useRoastingSettingsImport();
    const tk = (key: string, options?: Record<string, string | number>) =>
        t([`settings.${product.toLowerCase()}.${key}`, `settings.firescope.${key}`], options);

    return (
        <SettingsSection group="import">
            <SettingsSection.Header title={tk('title')} description={tk('description')} />
            <SettingsSection.Body className="grid gap-3">
                <label className="flex flex-wrap items-center gap-3 text-xs text-secondary">
                    {t('settings.roastingImport.source')}
                    <FormSelect
                        value={product}
                        disabled={applying}
                        wrapperClassName="w-40"
                        className="h-8 py-1 text-xs"
                        onChange={(event) => selectProduct(event.currentTarget.value as typeof product)}
                    >
                        <option value="Firescope">Firescope</option>
                        <option value="Artisan">Artisan</option>
                        <option value="Cropster">Cropster</option>
                    </FormSelect>
                </label>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="m-0 text-xs text-secondary" role="status">
                        {query.isFetching
                            ? tk('searching')
                            : query.error
                              ? tk('scanFailed')
                              : snapshot
                                ? tk(`status.${snapshot.status}`)
                                : tk('searching')}
                    </p>
                    <SurfaceButton disabled={busy} onClick={rescan}>
                        {tk('rescan')}
                    </SurfaceButton>
                </div>
                {snapshot?.status === 'found' && (
                    <>
                        {artisan && artisan.source.version === null && (
                            <label className="flex items-start gap-3 text-xs text-secondary">
                                <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                                    checked={confirmedVersion !== null}
                                    disabled={applying}
                                    onChange={(event) => confirmVersion(event.currentTarget.checked)}
                                />
                                <span>{tk('confirmVersion')}</span>
                            </label>
                        )}
                        <div className="min-w-0 overflow-hidden rounded-xl border border-border">
                            <div className="border-b border-border-subtle px-4 py-3">
                                <h3 className="m-0 text-[13px] font-medium text-primary">{tk('machineHeading')}</h3>
                                <p className="mb-0 mt-1 text-xs text-muted">{tk('machineHint')}</p>
                            </div>
                            <div className="divide-y divide-border-subtle">
                                {candidates.map(({ sequence, current, connection, mapping, existing, update }) => (
                                    <RoastingMachinePreview
                                        key={sequence}
                                        current={current}
                                        connection={connection}
                                        mapping={mapping}
                                        imported={Boolean(existing) && !update}
                                        updateAvailable={Boolean(update)}
                                        selected={selectedIds.has(sequence)}
                                        disabled={applying}
                                        onSelectedChange={(checked) => selectMachine(sequence, checked)}
                                        tk={tk}
                                    />
                                ))}
                                {candidates.length === 0 && (
                                    <p className="m-0 p-4 text-xs text-muted">{tk('noMachines')}</p>
                                )}
                            </div>
                        </div>
                        {graph && graph.fields.length > 0 && (
                            <RoastingGraphPreview
                                graph={graph}
                                previous={roastSettings}
                                checked={includeGraph}
                                hasGraph={hasGraph}
                                unit={unit}
                                disabled={applying}
                                onCheckedChange={setIncludeGraph}
                                onUnitChange={setUnitOverride}
                                unitEditable={product === 'Firescope'}
                                tk={tk}
                            />
                        )}
                        <p className="m-0 text-xs text-muted">{tk('applyNote')}</p>
                        {!withinLimit && (
                            <p className="m-0 text-xs text-secondary" role="alert">
                                {tk('planLimit')}
                            </p>
                        )}
                        <PillButton
                            type="button"
                            disabled={!canApply}
                            className="justify-center disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() => void apply()}
                        >
                            {applying
                                ? tk('saving')
                                : selectedCount > 0
                                  ? tk(includeGraph && hasGraph ? 'applyBoth' : 'applyMachines', {
                                        count: selectedCount,
                                    })
                                  : tk(includeGraph && hasGraph ? 'applyGraph' : 'apply')}
                        </PillButton>
                    </>
                )}
                {result && (
                    <p
                        className={`m-0 text-xs ${result === 'failed' || result === 'graphSavedMachinesFailed' ? 'text-phase-danger' : 'text-secondary'}`}
                        role={result === 'failed' || result === 'graphSavedMachinesFailed' ? 'alert' : 'status'}
                    >
                        {tk(result)}
                    </p>
                )}
            </SettingsSection.Body>
        </SettingsSection>
    );
}
