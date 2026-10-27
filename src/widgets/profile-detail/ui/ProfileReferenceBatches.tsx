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
}: {
    profileId: string;
    sourceSessionId: string;
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
        <div className="bg-surface dark:bg-surface-elevated mb-5 rounded-lg px-4 py-3" aria-busy={isPending}>
            <p className="mb-2 text-[11px] font-medium tracking-[0.5px] text-muted uppercase">
                {t('profiles.detail.batches')}
            </p>
            <div className="max-h-64 overflow-y-auto">
                <table className="w-full border-collapse text-xs">
                    <thead>
                        <tr className="text-left text-muted">
                            <th className="py-2 pr-4 font-medium">{t('history.table.date')}</th>
                            <th className="py-2 pr-4 font-medium">{t('history.batchNumbers.label')}</th>
                            <th className="py-2 pr-4 font-medium">{t('history.recordText.title')}</th>
                            <th className="py-2 font-medium" />
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
                                    tabIndex={0}
                                    aria-current={current ? 'true' : undefined}
                                    onClick={() => select(batch)}
                                    onKeyDown={(event) => {
                                        if (event.target !== event.currentTarget) return;
                                        if (event.key !== 'Enter' && event.key !== ' ') return;
                                        event.preventDefault();
                                        select(batch);
                                    }}
                                    className={`cursor-pointer border-t border-black/4 dark:border-border ${current ? 'bg-surface-elevated dark:bg-main-bg' : ''}`}
                                >
                                    <td className="py-2 pr-4 font-mono text-muted">
                                        {formatDateShort(batch.roasted_at)}
                                    </td>
                                    <td className="py-2 pr-4 text-secondary tabular-nums">
                                        {sessionBatchNumberLabel(batch, totalBatchPrefix) ?? '—'}
                                    </td>
                                    <td className="py-2 pr-4 font-medium text-primary">{title}</td>
                                    <td className="py-2 text-right">
                                        {current && (
                                            <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium tracking-[0.14px] text-secondary">
                                                {t('newProfileModal.basedOn')}
                                            </span>
                                        )}
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
