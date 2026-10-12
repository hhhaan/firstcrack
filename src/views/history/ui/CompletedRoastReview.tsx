import { useActiveWorkspace } from '@entities/organization';
import { useRoastSession } from '@entities/roast';
import { useCreateRoastProfile } from '@entities/roast-profile';
import type { RoastProfile } from '@shared/types/database.types';
import { NewProfileModal } from '@widgets/new-profile-modal';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HistorySessionDetail } from './HistorySessionDetail';

export const CompletedRoastReview = ({ sessionId, onBack }: { sessionId: string; onBack: () => void }) => {
    const { t } = useTranslation();
    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: session, isLoading, isError } = useRoastSession(workspaceOwnerId, sessionId);
    const { mutateAsync: createProfile } = useCreateRoastProfile(workspaceOwnerId);
    const [promoteId, setPromoteId] = useState<string | null>(null);
    const promote = async ({ id: _id, created_at: _created, updated_at: _updated, ...insert }: RoastProfile) => {
        await createProfile(insert);
    };
    return (
        <div data-testid="completed-roast-review">
            <div className="mb-4 flex items-center justify-between gap-3">
                <span className="text-sm text-secondary">{t('activeRoast.review.title')}</span>
                <button
                    type="button"
                    data-testid="return-to-charge-wait"
                    onClick={onBack}
                    className="rounded-full border border-border bg-main-bg px-4 py-2 text-sm text-primary"
                >
                    {t('activeRoast.review.return')}
                </button>
            </div>
            {isLoading && <p role="status">{t('common.loading')}</p>}
            {(isError || (!isLoading && !session)) && <p role="alert">{t('activeRoast.review.failed')}</p>}
            {session && session.user_id === workspaceOwnerId && (
                <HistorySessionDetail
                    session={session}
                    onBack={onBack}
                    backLabel={t('activeRoast.review.return')}
                    onSaveAsProfile={setPromoteId}
                />
            )}
            {promoteId && (
                <NewProfileModal
                    open
                    initialSessionId={promoteId}
                    onClose={() => setPromoteId(null)}
                    onCreated={promote}
                />
            )}
        </div>
    );
};
