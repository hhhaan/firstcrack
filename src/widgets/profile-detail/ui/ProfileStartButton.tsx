import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import {
    profileSourceCandidates,
    type RoastProfileWithSource,
    type RoastSourceCandidate,
    useProfileSourceHistory,
} from '@entities/roast-profile';
import { useRoastingStore } from '@features/active-roast/model/status';
import type { View } from '@shared/types/view';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export const ProfileStartButton = ({
    profile,
    onNavigate,
}: {
    profile: Pick<RoastProfileWithSource, 'id' | 'sources' | 'default_bean_id' | 'default_blend_id'>;
    onNavigate: (view: View) => void;
}) => {
    const { t } = useTranslation();
    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: beans = [], isPending: beansPending } = useBeans(workspaceOwnerId);
    const { data: blends = [], isPending: blendsPending } = useBlends(workspaceOwnerId);
    const { data: history = [], isPending: historyPending } = useProfileSourceHistory(workspaceOwnerId, profile.id);
    const sources = profileSourceCandidates(profile, history, beans, blends);
    const inventoryOn = !!workspaceOwnerId;
    const waiting = (inventoryOn && (beansPending || blendsPending)) || (inventoryOn && !!profile.id && historyPending);
    const [open, setOpen] = useState(false);
    const start = (source?: RoastSourceCandidate) => {
        useRoastingStore.getState().setPendingProfile(profile.id, source);
        setOpen(false);
        onNavigate('roast');
    };

    return (
        <Popover open={open && sources.length > 1} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={waiting}
                    onClick={() => {
                        if (sources.length <= 1) start(sources[0]);
                    }}
                    className="flex-1 py-2.5 rounded-full border-none bg-action text-on-action text-sm font-medium cursor-pointer tracking-[0.14px] disabled:opacity-50 disabled:cursor-default"
                >
                    {t('profiles.detail.startWith')}
                </button>
            </PopoverTrigger>
            <PopoverContent aria-label={t('activeRoast.header.profileSources')} className="min-w-64 max-w-sm p-2">
                <p className="px-2.5 py-2 text-xs text-muted">{t('activeRoast.header.profileSources')}</p>
                <div className="max-h-64 overflow-y-auto">
                    {sources.map((source) => (
                        <button
                            key={source.blendId ? `blend:${source.blendId}` : `bean:${source.beanId}`}
                            type="button"
                            onClick={() => start(source)}
                            className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg border-none bg-transparent px-2.5 py-2 text-left text-sm text-primary hover:bg-surface focus-visible:bg-surface"
                        >
                            <span>{source.name}</span>
                            <span className="shrink-0 text-xs text-muted">
                                {t(source.blendId ? 'newProfileModal.blend' : 'newProfileModal.singleOrigin')}
                            </span>
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
};
