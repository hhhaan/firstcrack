import { useActiveWorkspace } from '@entities/organization';
import { useSetOutputWeight } from '@entities/roast';
import { buildRoastedInbound } from '@features/active-roast/lib/roastedInbound';
import { computeRoastWeights } from '@shared/lib/roastWeight';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { formErrorCls } from '@shared/ui/form-styles';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface OutputWeightEditorProps {
    session: RoastSessionWithRelations;
}

/**
 * Post-roast output weight entry — the scale reading happens after cooling/bagging,
 * long after the save modal is gone, so History is where it actually gets typed in.
 * Atomic RPC: session.output_weight_grams + roasted inbound upsert.
 */
export const OutputWeightEditor = ({ session }: OutputWeightEditorProps) => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { mutateAsync: setOutputWeight, isPending } = useSetOutputWeight(workspaceOwnerId);

    const [draft, setDraft] = useState(() =>
        session.output_weight_grams != null ? String(session.output_weight_grams) : '',
    );
    const [invalid, setInvalid] = useState(false);

    const { lossRate, measured } = computeRoastWeights(
        session.weight_grams,
        session.output_weight_grams,
        session.roast_level,
    );

    const commit = async () => {
        const trimmed = draft.trim();
        const next = trimmed === '' ? null : Number(trimmed);
        // mirrors the DB check: null, or 0 < g <= green input
        const valid = next === null || (Number.isInteger(next) && next > 0 && next <= session.weight_grams);
        if (!valid) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        if (next === (session.output_weight_grams ?? null)) return;
        if (!isWorkspaceReady || !workspaceOwnerId) return;
        try {
            const inbound = buildRoastedInbound({
                greenGrams: session.weight_grams,
                outputWeightGrams: next,
                roastLevel: session.roast_level,
            });
            await setOutputWeight({
                sessionId: session.id,
                outputGrams: next,
                inboundGrams: inbound?.grams ?? 0,
                inboundIsEstimate: inbound?.isEstimate ?? false,
            });
        } catch {
            setDraft(session.output_weight_grams != null ? String(session.output_weight_grams) : '');
        }
    };

    return (
        <div className="mb-2">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                {t('history.expanded.outputWeight')}
            </div>
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={session.weight_grams}
                    value={draft}
                    disabled={isPending}
                    placeholder="—"
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setInvalid(false);
                    }}
                    onBlur={() => void commit()}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    className={`w-20 rounded border bg-transparent px-1.5 py-0.5 font-mono text-[13px] font-medium tracking-[0.14px] text-primary outline-none ${
                        invalid ? 'border-red-500' : 'border-border-subtle focus:border-border'
                    }`}
                />
                <span className="text-[11px] font-semibold text-muted">g</span>
                {session.weight_grams > 0 && (
                    <span className="font-mono text-[12px] text-secondary">
                        −{lossRate.toFixed(1)}%{!measured && ` (${t('history.expanded.estimated')})`}
                    </span>
                )}
            </div>
            {invalid && (
                <p className={formErrorCls}>
                    {t('history.expanded.outputWeightInvalid', { max: session.weight_grams })}
                </p>
            )}
        </div>
    );
};
