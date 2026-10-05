import { useUpdateBean } from '@entities/bean';
import { useActiveWorkspace } from '@entities/organization';
import { invalidateRoastSessionQueries, useSetOutputWeight, useUpdateRoastSession } from '@entities/roast';
import { useRoastProfiles } from '@entities/roast-profile';
import { buildRoastedInbound } from '@features/active-roast/lib/roastedInbound';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { FormSelect } from '@shared/ui/FormSelect';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'] as const;

const labelCls = 'mb-1 block text-[11px] font-medium tracking-[0.3px] text-muted';

const isKnownLevel = (level: string): level is (typeof ROAST_LEVELS)[number] =>
    (ROAST_LEVELS as readonly string[]).includes(level);

/** History edit of origin (the green bean), linked profile, and roast level. */
export const SummaryMetaEditor = ({ session }: { session: RoastSessionWithRelations }) => {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { data: profiles = [] } = useRoastProfiles(workspaceOwnerId);
    const { mutateAsync: updateBean, isPending: beanPending } = useUpdateBean(workspaceOwnerId);
    const { mutateAsync: updateSession, isPending: sessionPending } = useUpdateRoastSession(workspaceOwnerId);
    const { mutateAsync: setOutputWeight, isPending: weightPending } = useSetOutputWeight(workspaceOwnerId);
    const canWrite = isWorkspaceReady && !!workspaceOwnerId;
    const storedOrigin = session.beans?.origin ?? '';
    const [origin, setOrigin] = useState(storedOrigin);
    const [profileId, setProfileId] = useState(session.profile_id ?? '');
    const [level, setLevel] = useState(session.roast_level ?? '');

    useEffect(() => {
        setOrigin(storedOrigin);
        setProfileId(session.profile_id ?? '');
        setLevel(session.roast_level ?? '');
    }, [storedOrigin, session.profile_id, session.roast_level]);

    const profileOptions = profiles.map((profile) => ({ id: profile.id, name: profile.name }));
    if (session.profile_id && !profileOptions.some((profile) => profile.id === session.profile_id)) {
        profileOptions.unshift({
            id: session.profile_id,
            name: session.roast_profiles?.name || session.profile_id,
        });
    }
    const levelOptions = [...ROAST_LEVELS] as string[];
    if (session.roast_level && !isKnownLevel(session.roast_level)) levelOptions.unshift(session.roast_level);

    const levelLabel = (level: string) => (isKnownLevel(level) ? t(`newProfileModal.roastLevel.${level}`) : level);

    const commitOrigin = async () => {
        const next = origin.trim();
        if (next === storedOrigin.trim() || !session.bean_id || !canWrite) return;
        try {
            await updateBean({ id: session.bean_id, origin: next === '' ? null : next });
            await invalidateRoastSessionQueries(qc, workspaceOwnerId);
        } catch {
            setOrigin(storedOrigin);
        }
    };

    const commitProfile = async (raw: string) => {
        const next = raw === '' ? null : raw;
        if (next === session.profile_id || !canWrite) return;
        try {
            await updateSession({ id: session.id, profile_id: next });
        } catch {
            setProfileId(session.profile_id ?? '');
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
                <label htmlFor={`history-profile-${session.id}`} className={labelCls}>
                    {t('history.table.profile')}
                </label>
                <FormSelect
                    id={`history-profile-${session.id}`}
                    data-testid="history-profile"
                    aria-label={t('history.table.profile')}
                    value={profileId}
                    disabled={busy || !canWrite}
                    onChange={(e) => {
                        setProfileId(e.target.value);
                        void commitProfile(e.target.value);
                    }}
                    className="py-1.5 text-[13px]"
                >
                    <option value="">—</option>
                    {profileOptions.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                            {profile.name}
                        </option>
                    ))}
                </FormSelect>
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
