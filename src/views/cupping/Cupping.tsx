import { useCuppingEvents, useInvalidateCuppingEvents } from '@entities/cupping';
import { useActiveWorkspace } from '@entities/organization';
import { FEATURE, useFeature } from '@shared/lib/features';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CuppingEventDetail } from './ui/CuppingEventDetail';
import { CuppingEventList } from './ui/CuppingEventList';

type CuppingProps = {
    onUpgrade?: () => void;
};

export const Cupping = ({ onUpgrade }: CuppingProps) => {
    const { t } = useTranslation();
    const canCupping = useFeature(FEATURE.cupping);
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: events = [], isLoading, isError, error } = useCuppingEvents(userId, canCupping);
    const invalidateEvents = useInvalidateCuppingEvents(userId);

    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

    const selected = events.find((e) => e.id === selectedEventId) ?? null;

    if (!canCupping) {
        return (
            <PageLayout>
                <PageHeader title={t('cupping.title')} subtitle={t('cupping.locked.subtitle')} />
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle bg-main-bg px-6 py-20 text-center dark:border-[#585d61]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface">
                        <Lock size={22} className="text-muted" />
                    </div>
                    <div>
                        <p className="text-[15px] font-medium text-primary">{t('cupping.locked.title')}</p>
                        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted">
                            {t('cupping.locked.description')}
                        </p>
                    </div>
                    {onUpgrade ? <PillButton onClick={onUpgrade}>{t('cupping.locked.cta')}</PillButton> : null}
                </div>
            </PageLayout>
        );
    }

    if (selectedEventId) {
        return (
            <CuppingEventDetail
                eventId={selectedEventId}
                event={selected}
                userId={userId}
                onBack={() => setSelectedEventId(null)}
                onDeleted={() => {
                    setSelectedEventId(null);
                }}
            />
        );
    }

    return (
        <CuppingEventList
            userId={userId}
            events={events}
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={() => void invalidateEvents()}
            onSelect={setSelectedEventId}
        />
    );
};
