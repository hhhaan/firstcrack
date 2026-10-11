import { useActiveWorkspace } from '@entities/organization';
import { useSetChargeWeight, useUpdateRoastSession } from '@entities/roast';
import { buildRoastedInbound } from '@features/active-roast/lib/roastedInbound';
import { MAX_BATCH_WEIGHT_KG } from '@features/active-roast/lib/roastSummarySchema';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { formErrorCls } from '@shared/ui/form-styles';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const CHARGE_MAX_GRAMS = MAX_BATCH_WEIGHT_KG * 1000;

const inputCls = (invalid: boolean) =>
    `w-full min-w-0 rounded-md border bg-main-bg px-2 py-1.5 font-mono text-[13px] font-medium tracking-[0.14px] text-primary outline-none ${
        invalid ? 'border-red-500' : 'border-border-subtle focus:border-border'
    }`;

const labelCls = 'mb-1 block text-[11px] font-medium tracking-[0.3px] text-muted';

/** Empty → null. Out of range or not a number → undefined (reject). One decimal place. */
const parseDecimal = (raw: string, min: number, max: number): number | null | undefined => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return undefined;
    const rounded = Math.round(n * 10) / 10;
    if (rounded < min || rounded > max) return undefined;
    return rounded;
};

type MeasurementColumn = 'ambient_temp_celsius' | 'ambient_humidity_pct' | 'moisture_pct' | 'density_g_per_l';

const MEASUREMENTS: {
    column: MeasurementColumn;
    labelKey:
        | 'history.expanded.ambientTemp'
        | 'history.expanded.ambientHumidity'
        | 'history.expanded.moisture'
        | 'history.expanded.density';
    testId: string;
    min: number;
    max: number;
}[] = [
    {
        column: 'ambient_temp_celsius',
        labelKey: 'history.expanded.ambientTemp',
        testId: 'history-ambient-temp',
        min: -40,
        max: 80,
    },
    {
        column: 'ambient_humidity_pct',
        labelKey: 'history.expanded.ambientHumidity',
        testId: 'history-ambient-humidity',
        min: 0,
        max: 100,
    },
    { column: 'moisture_pct', labelKey: 'history.expanded.moisture', testId: 'history-moisture', min: 0, max: 100 },
    { column: 'density_g_per_l', labelKey: 'history.expanded.density', testId: 'history-density', min: 0.1, max: 2000 },
];

/**
 * Corrects green charge after save. 0 is the same unset value the summary saves.
 * A positive weight rescales session-owned roast deductions. 0 does not: a roast
 * ledger row cannot be 0g, so those rows stay until a positive weight is entered.
 */
export const ChargeWeightEditor = ({ session }: { session: RoastSessionWithRelations }) => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { mutateAsync: setChargeWeight, isPending } = useSetChargeWeight(workspaceOwnerId);
    const [draft, setDraft] = useState(() => String(session.weight_grams));
    const [invalid, setInvalid] = useState(false);
    const min =
        session.output_weight_grams != null && session.output_weight_grams > 0 ? session.output_weight_grams : 0;

    const commit = async () => {
        const trimmed = draft.trim();
        if (trimmed === String(session.weight_grams)) {
            setInvalid(false);
            return;
        }
        const next = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
        const valid = Number.isInteger(next) && next >= min && next <= CHARGE_MAX_GRAMS;
        if (!valid) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        if (next === session.weight_grams) return;
        if (!isWorkspaceReady || !workspaceOwnerId) return;
        const inbound = buildRoastedInbound({
            greenGrams: next,
            outputWeightGrams: session.output_weight_grams,
            roastLevel: session.roast_level,
        });
        try {
            await setChargeWeight({
                sessionId: session.id,
                weightGrams: next,
                inboundGrams: inbound?.grams ?? 0,
                inboundIsEstimate: inbound?.isEstimate ?? false,
            });
        } catch {
            setDraft(String(session.weight_grams));
        }
    };

    return (
        <div>
            <label htmlFor={`history-charge-weight-${session.id}`} className={labelCls}>
                {t('history.expanded.chargeWeight')}
            </label>
            <div className="flex items-center gap-2">
                <input
                    id={`history-charge-weight-${session.id}`}
                    data-testid="history-charge-weight"
                    type="number"
                    inputMode="numeric"
                    min={min}
                    max={CHARGE_MAX_GRAMS}
                    step={1}
                    value={draft}
                    disabled={isPending}
                    aria-label={t('history.expanded.chargeWeight')}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setInvalid(false);
                    }}
                    onBlur={() => void commit()}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    className={`${inputCls(invalid)} w-24`}
                />
                <span className="text-[11px] font-semibold text-muted">g</span>
            </div>
            {invalid && (
                <p className={formErrorCls}>
                    {t('history.expanded.chargeWeightInvalid', { min, max: CHARGE_MAX_GRAMS })}
                </p>
            )}
        </div>
    );
};

const MeasurementField = ({
    session,
    column,
    labelKey,
    testId,
    min,
    max,
}: {
    session: RoastSessionWithRelations;
    column: MeasurementColumn;
    labelKey: (typeof MEASUREMENTS)[number]['labelKey'];
    testId: string;
    min: number;
    max: number;
}) => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { mutateAsync: updateSession, isPending } = useUpdateRoastSession(workspaceOwnerId);
    const stored = session[column];
    const [draft, setDraft] = useState(() => (stored == null ? '' : String(stored)));
    const [invalid, setInvalid] = useState(false);

    const commit = async () => {
        const next = parseDecimal(draft, min, max);
        if (next === undefined) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        if (next === (stored ?? null)) return;
        if (!isWorkspaceReady || !workspaceOwnerId) return;
        try {
            await updateSession({ id: session.id, [column]: next });
        } catch {
            setDraft(stored == null ? '' : String(stored));
        }
    };

    return (
        <div>
            <label htmlFor={`${testId}-${session.id}`} className={labelCls}>
                {t(labelKey)}
            </label>
            <input
                id={`${testId}-${session.id}`}
                data-testid={testId}
                type="number"
                inputMode="decimal"
                min={min}
                max={max}
                step={0.1}
                value={draft}
                disabled={isPending}
                placeholder="—"
                aria-label={t(labelKey)}
                onChange={(e) => {
                    setDraft(e.target.value);
                    setInvalid(false);
                }}
                onBlur={() => void commit()}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className={inputCls(invalid)}
            />
            {invalid && <p className={formErrorCls}>{t('history.expanded.qcInvalid', { min, max })}</p>}
        </div>
    );
};

/** Room temp, humidity, moisture, and density. No stock side effects. */
export const QcMeasurementEditor = ({ session }: { session: RoastSessionWithRelations }) => (
    <div className="grid grid-cols-2 gap-3">
        {MEASUREMENTS.map((field) => (
            <MeasurementField key={field.column} session={session} {...field} />
        ))}
    </div>
);
