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
import { Check, ChevronRight } from 'lucide-react';
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
        <div
            className="@container mb-5 overflow-hidden rounded-xl border border-border bg-main-bg"
            aria-busy={isPending}
        >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
                <p className="text-sm font-medium text-primary">{t('profiles.detail.batches')}</p>
                <Badge size="sm">{batches.length}</Badge>
            </div>
            <div className="visible-scrollbar max-h-80 overflow-y-auto">
                <ul className="divide-y divide-border" aria-label={t('profiles.detail.batches')}>
                    {batches.map((batch) => {
                        const current = batch.id === resolvedId;
                        const title = sessionRoastTitle(batch) ?? t('profiles.detail.untitledBatch');
                        return (
                            <li
                                key={batch.id}
                                data-testid="profile-reference-row"
                                data-current={current ? 'true' : 'false'}
                                aria-current={current ? 'true' : undefined}
                                className={`flex flex-col gap-3 px-4 py-3 transition-colors @lg:flex-row @lg:items-center @lg:justify-between ${current ? 'bg-emerald-50/80 dark:bg-emerald-950/35' : 'hover:bg-surface-elevated'}`}
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="break-words text-sm font-medium leading-5 text-primary">{title}</p>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                                        <time dateTime={batch.roasted_at ?? undefined}>
                                            {formatDateShort(batch.roasted_at)}
                                        </time>
                                        <span aria-hidden="true">·</span>
                                        <span className="break-all">
                                            {sessionBatchNumberLabel(batch, totalBatchPrefix) ?? '—'}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center justify-end gap-2">
                                    {onOpenDetail && (
                                        <SurfaceButton
                                            data-testid="profile-reference-detail"
                                            className="border-transparent bg-transparent px-2 text-muted hover:bg-transparent hover:text-primary dark:border-transparent"
                                            onClick={() => onOpenDetail(batch.id)}
                                        >
                                            {t('history.expanded.show')}
                                            <ChevronRight size={13} strokeWidth={1.5} aria-hidden="true" />
                                        </SurfaceButton>
                                    )}
                                    <div className="flex w-32 shrink-0 justify-center">
                                        {current ? (
                                            <Badge
                                                tone="good"
                                                icon={<Check size={12} strokeWidth={1.5} aria-hidden="true" />}
                                                className="text-emerald-800 dark:text-emerald-200"
                                            >
                                                {t('profiles.detail.currentReference')}
                                            </Badge>
                                        ) : (
                                            <SurfaceButton
                                                data-testid="profile-reference-set"
                                                disabled={isPending}
                                                className="w-full border-border bg-main-bg text-secondary hover:border-strong-border hover:text-primary"
                                                onClick={() => select(batch)}
                                            >
                                                {t('profiles.detail.setReference')}
                                            </SurfaceButton>
                                        )}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
};
