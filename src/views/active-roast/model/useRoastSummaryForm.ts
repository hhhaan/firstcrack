import { useBeans } from '@entities/bean/queries';
import { useActiveWorkspace } from '@entities/organization';
import { useDayBatches } from '@entities/plan';
import { buildRoastSummarySchema, type RoastSummaryForm } from '@features/active-roast/lib/roastSummarySchema';
import { scheduleLinkFieldPatch, summaryFormInitialValues } from '@features/active-roast/lib/summaryPrefill';
import { toPlanBatchHandoff } from '@features/active-roast/lib/toPlanBatchHandoff';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { PlanBatchHandoff } from '@shared/types/database.types';
import { format } from 'date-fns';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { RoastSummaryData } from './useRoastCompletionFlow';

/**
 * Open/reopen form lifetime for the save modal.
 *
 * Initials, schedule-link patches, and deduct eligibility are the pure helpers
 * in summaryPrefill. This hook applies them once per open and when the linked
 * batch changes. It does not watch the live header bean. Field input and
 * display math stay in RoastSummaryModal.
 */
export const useRoastSummaryForm = ({
    open,
    summaryData,
    selectedBeanId,
    planBatchHandoff,
}: {
    open: boolean;
    summaryData: RoastSummaryData | null;
    selectedBeanId: string | null;
    planBatchHandoff: PlanBatchHandoff | null;
}) => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId, isWorkspaceReady } = useActiveWorkspace();
    const { data: beans = [] } = useBeans(userId);
    const today = format(new Date(), 'yyyy-MM-dd');
    const { data: dayBatches = [] } = useDayBatches(isWorkspaceReady ? userId : '', today);

    const hasHandoff = Boolean(planBatchHandoff);
    const incompleteBatches = useMemo(
        () => dayBatches.filter((b) => b.completed_sessions < b.batch_count),
        [dayBatches],
    );
    const roastSummarySchema = useMemo(() => buildRoastSummarySchema({ t, hasHandoff }), [hasHandoff, t]);

    const form = useForm<RoastSummaryForm>({
        resolver: zodResolver(roastSummarySchema),
        defaultValues: {
            notes: '',
            weightGrams: 0,
            outputWeightKg: undefined,
            roastLevel: null,
            beanId: selectedBeanId,
            beanLabel: '',
            linkMode: hasHandoff ? 'schedule' : 'none',
            planBatchId: planBatchHandoff?.planBatchId ?? null,
            deductStock: hasHandoff || selectedBeanId != null,
        },
    });
    const { watch, setValue, reset } = form;

    const linkMode = watch('linkMode');
    const formPlanBatchId = watch('planBatchId');

    /** Bumped when a prefill replaces the bean field so the combobox remounts. */
    const [beanFieldEpoch, setBeanFieldEpoch] = useState(0);

    const selectedBeanIdRef = useRef(selectedBeanId);
    const handoffRef = useRef(planBatchHandoff);
    const lastAdhoc = useRoastSessionStore((s) => s.lastAdhocSave);
    const lastAdhocRef = useRef(lastAdhoc);
    const openedBaseRef = useRef<{ weightGrams: number; beanId: string | null }>({ weightGrams: 0, beanId: null });
    const prevLinkRef = useRef<{ mode: 'schedule' | 'none'; batchId: string | null }>({
        mode: 'none',
        batchId: null,
    });
    useEffect(() => {
        selectedBeanIdRef.current = selectedBeanId;
    }, [selectedBeanId]);
    useEffect(() => {
        handoffRef.current = planBatchHandoff;
    }, [planBatchHandoff]);
    useEffect(() => {
        lastAdhocRef.current = lastAdhoc;
    }, [lastAdhoc]);

    useEffect(() => {
        if (open && summaryData) {
            const initial = summaryFormInitialValues(
                handoffRef.current,
                lastAdhocRef.current,
                selectedBeanIdRef.current,
            );
            openedBaseRef.current = { weightGrams: initial.weightGrams, beanId: initial.beanId };
            prevLinkRef.current = { mode: initial.linkMode, batchId: initial.planBatchId };
            reset(initial);
            setBeanFieldEpoch((k) => k + 1);
        }
    }, [open, summaryData, reset]);

    const linkedBatch = useMemo(() => {
        if (hasHandoff || linkMode !== 'schedule' || !formPlanBatchId) return null;
        return incompleteBatches.find((b) => b.id === formPlanBatchId) ?? null;
    }, [hasHandoff, linkMode, formPlanBatchId, incompleteBatches]);
    const effectiveHandoff = planBatchHandoff ?? (linkedBatch ? toPlanBatchHandoff(linkedBatch) : null);

    // Schedule batch select → prefill weight/bean. Primitives only so re-renders don't clobber edits.
    const linkedBatchId = linkedBatch?.id ?? null;
    const linkedBatchSizeKg = linkedBatch?.batch_size_kg ?? null;
    const linkedBeanId = linkedBatch?.bean_id ?? null;
    useEffect(() => {
        if (!open || !summaryData || hasHandoff) return;
        const patch = scheduleLinkFieldPatch({
            prevMode: prevLinkRef.current.mode,
            mode: linkMode,
            batch: linkedBatchId
                ? { id: linkedBatchId, batchSizeKg: linkedBatchSizeKg ?? 0, beanId: linkedBeanId }
                : null,
            prevBatchId: prevLinkRef.current.batchId,
            base: openedBaseRef.current,
        });
        prevLinkRef.current = { mode: linkMode, batchId: linkMode === 'schedule' ? linkedBatchId : null };
        if (!patch) return;
        setValue('weightGrams', patch.weightGrams, { shouldDirty: true, shouldValidate: true });
        setValue('beanId', patch.beanId, { shouldDirty: true, shouldValidate: true });
        setValue('beanLabel', '', { shouldDirty: true });
        setBeanFieldEpoch((k) => k + 1);
    }, [open, summaryData, hasHandoff, linkMode, linkedBatchId, linkedBatchSizeKg, linkedBeanId, setValue]);

    return { form, isWorkspaceReady, incompleteBatches, beans, effectiveHandoff, beanFieldEpoch };
};
