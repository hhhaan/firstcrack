import { useActiveWorkspace } from '@entities/organization';
import {
    type ProfileReferenceBatch,
    useProfileReferenceBatches,
    useSetProfileReference,
} from '@entities/roast-profile';
import { useRoastSettings } from '@features/active-roast';
import { formatDateShort } from '@shared/lib/format';
import { sessionBatchNumberLabel, sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import { useToastStore } from '@shared/store/toast';
import { Badge } from '@shared/ui/Badge';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const sourceSessionOf = (batch: ProfileReferenceBatch) => ({
    tsv_path: batch.tsv_path,
    bbp_tsv_path: batch.bbp_tsv_path,
    bbp_seconds: batch.bbp_seconds,
    events: null,
    ...(batch.heater_events !== undefined && { heater_events: batch.heater_events }),
});

export const ProfileReferenceBatches = ({
    profileId,
    sourceSessionId,
    onOpenDetail,
}: {
    profileId: string;
    sourceSessionId: string;
    onOpenDetail?: (sessionId: string) => void;
}) => {
    const { t } = useTranslation();
    const { workspaceOwnerId } = useActiveWorkspace();
    const totalBatchPrefix = useRoastSettings().totalBatchPrefix;
    const { data: batches = [] } = useProfileReferenceBatches(profileId);
    const { mutateAsync, isPending } = useSetProfileReference(workspaceOwnerId);
    const resolvedId = batches.some((batch) => batch.id === sourceSessionId)
        ? sourceSessionId
        : (batches[0]?.id ?? null);
    const attempted = useRef<string | null>(null);

    useEffect(() => {
        const batch = batches.find((item) => item.id === resolvedId);
        if (!batch || !workspaceOwnerId || batch.id === sourceSessionId) return;
        const key = `${profileId}:${batch.id}`;
        if (attempted.current === key) return;
        attempted.current = key;
        void mutateAsync({
            id: profileId,
            sourceSessionId: batch.id,
            sourceSession: sourceSessionOf(batch),
        }).catch(() => {
            useToastStore.getState().show(t('profiles.detail.referenceFailed'));
        });
    }, [batches, mutateAsync, profileId, resolvedId, sourceSessionId, t, workspaceOwnerId]);

    if (batches.length === 0) return null;

    const select = (batch: ProfileReferenceBatch) => {
        if (isPending || batch.id === resolvedId) return;
        void mutateAsync({
            id: profileId,
            sourceSessionId: batch.id,
            sourceSession: sourceSessionOf(batch),
        }).catch(() => {
            useToastStore.getState().show(t('profiles.detail.referenceFailed'));
        });
    };

    return (
        <div className="mb-5 overflow-hidden rounded-xl border border-border bg-main-bg" aria-busy={isPending}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <p className="text-xs font-medium text-primary">{t('profiles.detail.batches')}</p>
                <Badge size="sm">{batches.length}</Badge>
            </div>
            <div className="visible-scrollbar max-h-96 overflow-auto">
                <table
                    className="w-full min-w-[660px] table-fixed border-collapse text-xs"
                    aria-label={t('profiles.detail.batches')}
                >
                    <colgroup>
                        <col className="w-28" />
                        <col className="w-30" />
                        <col />
                        <col className={onOpenDetail ? 'w-64' : 'w-36'} />
                    </colgroup>
                    <thead>
                        <tr className="sticky top-0 z-10 bg-surface-elevated text-left text-[11px] text-muted">
                            <th scope="col" className="px-4 py-2.5 font-medium">
                                {t('history.table.date')}
                            </th>
                            <th scope="col" className="px-3 py-2.5 font-medium">
                                {t('history.batchNumbers.label')}
                            </th>
                            <th scope="col" className="px-3 py-2.5 font-medium">
                                {t('history.recordText.title')}
                            </th>
                            <th scope="col" className="px-4 py-2.5 font-medium">
                                <span className="sr-only">{t('profiles.detail.setReference')}</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {batches.map((batch) => {
                            const current = batch.id === resolvedId;
                            const title = sessionRoastTitle(batch) ?? '—';
                            return (
                                <tr
                                    key={batch.id}
                                    data-testid="profile-reference-row"
                                    data-current={current ? 'true' : 'false'}
                                    aria-current={current ? 'true' : undefined}
                                    className={`border-t border-border transition-colors ${current ? 'bg-surface-elevated' : 'hover:bg-surface-elevated/60'}`}
                                >
                                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                                        {formatDateShort(batch.roasted_at)}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 text-secondary">
                                        {sessionBatchNumberLabel(batch, totalBatchPrefix) ?? '—'}
                                    </td>
                                    <td className="px-3 py-3">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className="truncate font-medium text-primary" title={title}>
                                                {title}
                                            </span>
                                            {current && (
                                                <Badge icon={<Check size={11} strokeWidth={1.5} aria-hidden="true" />}>
                                                    {t('newProfileModal.basedOn')}
                                                </Badge>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {onOpenDetail && (
                                                <SurfaceButton
                                                    data-testid="profile-reference-detail"
                                                    className="border-transparent bg-transparent text-secondary underline decoration-border underline-offset-4 hover:bg-surface"
                                                    onClick={() => onOpenDetail(batch.id)}
                                                >
                                                    {t('history.expanded.show')}
                                                </SurfaceButton>
                                            )}
                                            <div className="w-30 shrink-0">
                                                {!current && (
                                                    <SurfaceButton
                                                        data-testid="profile-reference-set"
                                                        disabled={isPending}
                                                        className="w-full"
                                                        onClick={() => select(batch)}
                                                    >
                                                        {t('profiles.detail.setReference')}
                                                    </SurfaceButton>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
