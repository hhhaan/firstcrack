import { useBeans } from '@entities/bean';
import { useActiveWorkspace } from '@entities/organization';
import { useSetRoastLevel, useUpdateRoastSession } from '@entities/roast';
import { useRoastProfiles } from '@entities/roast-profile';
import { useUpdateRoastBeanOrigin } from '@features/update-roast-bean-origin';
import { useAuthStore } from '@shared/store/auth';
import { useCatalogVisibility } from '@shared/store/catalog-visibility';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { BeanCombobox } from '@shared/ui/BeanCombobox';
import { FormSelect } from '@shared/ui/FormSelect';
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

/** History edit of the linked green bean, its origin, linked profile, and roast level. */
export const SummaryMetaEditor = ({ session }: { session: RoastSessionWithRelations }) => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const { data: profiles = [] } = useRoastProfiles(workspaceOwnerId);
    const { data: beans = [] } = useBeans(workspaceOwnerId);
    const authUserId = useAuthStore((state) => state.user?.id ?? '');
    const { hidden: hiddenBeans } = useCatalogVisibility(authUserId, workspaceOwnerId, 'beans');
    const { mutateAsync: updateOrigin, isPending: beanPending } = useUpdateRoastBeanOrigin(workspaceOwnerId);
    const { mutateAsync: updateSession, isPending: sessionPending } = useUpdateRoastSession(workspaceOwnerId);
    const { mutateAsync: setRoastLevel, isPending: levelPending } = useSetRoastLevel(workspaceOwnerId);
    const canWrite = isWorkspaceReady && !!workspaceOwnerId;
    // Stock that already moved stays booked to the original bean — relinking would desync the ledgers.
    const { data: stockRecorded = false, isPending: stockCheckPending } = useRoastStockRecorded(
        session.id,
        session.plan_batch_id,
    );
    const beanLocked = stockRecorded || stockCheckPending;
    const storedOrigin = session.beans?.origin ?? '';
    const [origin, setOrigin] = useState(storedOrigin);
    const [profileId, setProfileId] = useState(session.profile_id ?? '');
    const [level, setLevel] = useState(session.roast_level ?? '');

    useEffect(() => {
        setOrigin(storedOrigin);
        setProfileId(session.profile_id ?? '');
        setLevel(session.roast_level ?? '');
    }, [storedOrigin, session.profile_id, session.roast_level]);

    const beanOptions = useMemo(() => {
        const visible = beans
            .filter((bean) => bean.id === session.bean_id || !hiddenBeans.has(bean.id))
            .map((bean) => ({ id: bean.id, name: bean.name }));
        if (session.bean_id && !visible.some((bean) => bean.id === session.bean_id)) {
            visible.unshift({ id: session.bean_id, name: session.beans?.name ?? session.bean_id });
        }
        return visible;
    }, [beans, hiddenBeans, session.bean_id, session.beans?.name]);

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
            await updateOrigin({ id: session.bean_id, origin: next === '' ? null : next });
        } catch {
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
            await setRoastLevel({ sessionId: session.id, roastLevel: next });
        } catch {
            setLevel(prev ?? '');
            return;
        }
    };

    const busy = sessionPending || levelPending;

    return (
        <div className="grid grid-cols-2 items-start gap-2">
            <div className="col-span-2 min-w-0">
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
                    className="[&_input]:h-8 [&_input]:min-h-8 [&_input]:rounded-md [&_input]:py-1 [&_input]:pl-2 [&_input]:shadow-none"
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
            <div className="col-span-2 min-w-0">
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
                    className="min-h-8 rounded-md py-1 pl-2 text-[13px] shadow-none"
                >
                    <option value="">—</option>
                    {profileOptions.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                            {profile.name}
                        </option>
                    ))}
                </FormSelect>
            </div>
            <div className="min-w-0">
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
                        className="h-8 w-full min-w-0 rounded-md border border-border-subtle bg-main-bg px-2 py-1 text-[13px] text-primary outline-none focus:border-strong-border focus-visible:ring-2 focus-visible:ring-strong-border/40"
                    />
                ) : (
                    <p className="m-0 flex h-8 items-center text-[13px] text-secondary">—</p>
                )}
            </div>
            <div className="min-w-0">
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
                    className="min-h-8 rounded-md py-1 pl-2 text-[13px] shadow-none"
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
