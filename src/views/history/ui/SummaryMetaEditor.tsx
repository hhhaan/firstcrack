import { useBeans, useUpdateBean } from '@entities/bean';
import { useActiveWorkspace } from '@entities/organization';
import {
    applyOptimisticSessionBeanOrigin,
    invalidateRoastSessionQueries,
    restoreRoastSessionCaches,
    roastSessionKeys,
    snapshotRoastSessionCaches,
    useSetOutputWeight,
    useUpdateRoastSession,
} from '@entities/roast';
import { buildRoastedInbound } from '@features/active-roast/lib/roastedInbound';
import { useAuthStore } from '@shared/store/auth';
import { useCatalogVisibility } from '@shared/store/catalog-visibility';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { BeanCombobox } from '@shared/ui/BeanCombobox';
import { FormSelect } from '@shared/ui/FormSelect';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoastStockRecorded } from '../hooks/useRoastStockRecorded';

const ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'] as const;

const labelCls = 'mb-1 block text-[11px] font-medium tracking-[0.3px] text-muted';

const isKnownLevel = (level: string): level is (typeof ROAST_LEVELS)[number] =>
    (ROAST_LEVELS as readonly string[]).includes(level);

/**
 * Rows saved before titles were snapshotted still derive their title from the linked bean.
 * Freeze what is shown now so changing the bean source cannot rename the roast.
 */
const frozenTitleFor = (session: RoastSessionWithRelations): string | null =>
    session.batch_name?.trim() ? null : session.bean_label?.trim() || session.beans?.name?.trim() || null;

/** History edits retain the profile and numbers fixed at save. */
export const SummaryMetaEditor = ({ session }: { session: RoastSessionWithRelations }) => {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { data: beans = [] } = useBeans(workspaceOwnerId);
    const authUserId = useAuthStore((state) => state.user?.id ?? '');
    const { hidden: hiddenBeans } = useCatalogVisibility(authUserId, workspaceOwnerId, 'beans');
    const { mutateAsync: updateBean, isPending: beanPending } = useUpdateBean(workspaceOwnerId);
    const { mutateAsync: updateSession, isPending: sessionPending } = useUpdateRoastSession(workspaceOwnerId);
    const { mutateAsync: setOutputWeight, isPending: weightPending } = useSetOutputWeight(workspaceOwnerId);
    const canWrite = isWorkspaceReady && !!workspaceOwnerId;
    // Stock that already moved stays booked to the original bean — relinking would desync the ledgers.
    const { data: stockRecorded = false, isPending: stockCheckPending } = useRoastStockRecorded(
        session.id,
        session.plan_batch_id,
    );
    const beanLocked = stockRecorded || stockCheckPending;
    const storedOrigin = session.beans?.origin ?? '';
    const [origin, setOrigin] = useState(storedOrigin);
    const [level, setLevel] = useState(session.roast_level ?? '');

    useEffect(() => {
        setOrigin(storedOrigin);
        setLevel(session.roast_level ?? '');
    }, [storedOrigin, session.roast_level]);

    const beanOptions = useMemo(() => {
        const visible = beans
            .filter((bean) => bean.id === session.bean_id || !hiddenBeans.has(bean.id))
            .map((bean) => ({ id: bean.id, name: bean.name }));
        if (session.bean_id && !visible.some((bean) => bean.id === session.bean_id)) {
            visible.unshift({ id: session.bean_id, name: session.beans?.name ?? session.bean_id });
        }
        return visible;
    }, [beans, hiddenBeans, session.bean_id, session.beans?.name]);

    const levelOptions = [...ROAST_LEVELS] as string[];
    if (session.roast_level && !isKnownLevel(session.roast_level)) levelOptions.unshift(session.roast_level);

    const levelLabel = (level: string) => (isKnownLevel(level) ? t(`newProfileModal.roastLevel.${level}`) : level);

    const commitOrigin = async () => {
        const next = origin.trim();
        if (next === storedOrigin.trim() || !session.bean_id || !canWrite) return;
        await qc.cancelQueries({ queryKey: roastSessionKeys.all(workspaceOwnerId) });
        const snapshot = snapshotRoastSessionCaches(qc, workspaceOwnerId);
        applyOptimisticSessionBeanOrigin(qc, workspaceOwnerId, session.bean_id, next === '' ? null : next);
        try {
            await updateBean({ id: session.bean_id, origin: next === '' ? null : next });
            await invalidateRoastSessionQueries(qc, workspaceOwnerId);
        } catch {
            restoreRoastSessionCaches(qc, snapshot);
            setOrigin(storedOrigin);
        }
    };

    const commitBean = async (raw: string) => {
        if (beanLocked) return;
        const next = raw === '' ? null : raw;
        if (next === session.bean_id || !canWrite) return;
        const frozenTitle = frozenTitleFor(session);
        try {
            // A linked inventory bean supersedes the free-text label in the same write.
            await updateSession({
                id: session.id,
                bean_id: next,
                ...(next ? { bean_label: null } : {}),
                ...(frozenTitle ? { batch_name: frozenTitle } : {}),
            });
        } catch {
            // The field falls back to the stored row on the next render.
        }
    };

    /** Free-text commit (blur/Enter): no inventory bean, the typed name is the label. */
    const commitBeanLabel = async (raw: string) => {
        if (beanLocked) return;
        const next = raw.trim() || null;
        if (!canWrite) return;
        if (next === (session.bean_label?.trim() || null) && !session.bean_id) return;
        const frozenTitle = frozenTitleFor(session);
        try {
            await updateSession({
                id: session.id,
                bean_id: null,
                bean_label: next,
                ...(frozenTitle ? { batch_name: frozenTitle } : {}),
            });
        } catch {
            // Keep the typed text; the next refetch restores the stored label.
        }
    };

    const commitLevel = async (raw: string) => {
        const next = raw === '' ? null : raw;
        const prev = session.roast_level ?? null;
        if (next === prev || !canWrite) return;
        try {
            await updateSession({ id: session.id, roast_level: next });
        } catch {
            setLevel(prev ?? '');
            return;
        }
        const measured = session.output_weight_grams != null && session.output_weight_grams > 0;
        if (measured) return;
        const inbound = buildRoastedInbound({
            greenGrams: session.weight_grams,
            outputWeightGrams: null,
            roastLevel: next,
        });
        if (!inbound) return;
        try {
            await setOutputWeight({
                sessionId: session.id,
                outputGrams: null,
                inboundGrams: inbound.grams,
                inboundIsEstimate: true,
            });
        } catch {
            setLevel(prev ?? '');
            try {
                await updateSession({ id: session.id, roast_level: prev });
            } catch {
                // Level saved; the previous estimate stays until the next output edit.
            }
        }
    };

    const busy = sessionPending || weightPending;

    return (
        <div className="space-y-4">
            <div>
                <label htmlFor={`history-bean-${session.id}`} className={labelCls}>
                    {t('activeRoast.summary.bean')}
                </label>
                <BeanCombobox
                    id={`history-bean-${session.id}`}
                    data-testid="history-bean"
                    items={beanOptions}
                    selectedId={session.bean_id ?? ''}
                    initialQuery={session.bean_label ?? ''}
                    compact
                    disabled={sessionPending || !canWrite || beanLocked}
                    placeholder={t('activeRoast.summary.beanComboboxPlaceholder')}
                    emptyLabel={t('activeRoast.summary.beanComboboxEmpty')}
                    listToggleLabel={t('activeRoast.summary.beanComboboxToggle')}
                    onSelect={(id) => {
                        if (id) void commitBean(id);
                    }}
                    onFreeTextCommit={(name) => {
                        void commitBeanLabel(name);
                    }}
                />
                {stockRecorded && (
                    <p className="mt-1 mb-0 text-[11px] text-muted">{t('history.expanded.beanLocked')}</p>
                )}
            </div>
            <div>
                <label htmlFor={`history-origin-${session.id}`} className={labelCls}>
                    {t('history.expanded.origin')}
                </label>
                {session.bean_id ? (
                    <input
                        id={`history-origin-${session.id}`}
                        data-testid="history-origin"
                        value={origin}
                        disabled={beanPending || !canWrite}
                        placeholder="—"
                        aria-label={t('history.expanded.origin')}
                        onChange={(e) => setOrigin(e.target.value)}
                        onBlur={() => void commitOrigin()}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                        className="w-full rounded-md border border-border-subtle bg-main-bg px-2 py-1.5 text-[13px] text-primary outline-none focus:border-border"
                    />
                ) : (
                    <p className="m-0 text-[13px] text-secondary">—</p>
                )}
            </div>
            <div>
                <span className={labelCls}>{t('history.table.profile')}</span>
                <p
                    id={`history-profile-${session.id}`}
                    data-testid="history-profile"
                    className="m-0 text-[13px] text-secondary"
                >
                    {session.roast_profiles?.name || '—'}
                </p>
            </div>
            <div>
                <label htmlFor={`history-level-${session.id}`} className={labelCls}>
                    {t('history.table.level')}
                </label>
                <FormSelect
                    id={`history-level-${session.id}`}
                    data-testid="history-level"
                    aria-label={t('history.table.level')}
                    value={level}
                    disabled={busy || !canWrite}
                    onChange={(e) => {
                        setLevel(e.target.value);
                        void commitLevel(e.target.value);
                    }}
                    className="py-1.5 text-[13px]"
                >
                    <option value="">—</option>
                    {levelOptions.map((level) => (
                        <option key={level} value={level}>
                            {levelLabel(level)}
                        </option>
                    ))}
                </FormSelect>
            </div>
        </div>
    );
};
