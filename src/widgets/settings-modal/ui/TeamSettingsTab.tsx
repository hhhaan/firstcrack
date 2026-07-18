import { useActiveWorkspace, useMyOrganization, useRevokeOrgInvite } from '@entities/organization';
import { useCreateInvite, useRedeemInvite, useRemoveMember } from '@features/team-invite';
import { SectionCard } from '@shared/ui/SectionCard';
import { Check, Copy, Trash2, UserMinus, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsOptionRow, settingsOptionLabelCls } from './SettingsOptionRow';

const actionBtnCls =
    'flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#262B31] text-[13px] font-medium text-[#111827] dark:text-[#e5e5e5] hover:bg-[#F9FAFB] dark:hover:bg-[#181d21] active:opacity-90 transition-all cursor-pointer disabled:opacity-50';

const primaryBtnCls =
    'flex items-center gap-2 px-4 py-2.5 rounded-lg bg-palette-teal/15 text-palette-teal border border-palette-teal/30 text-[13px] font-semibold hover:bg-palette-teal/25 active:bg-palette-teal/30 disabled:opacity-50 transition-all cursor-pointer';

export function TeamSettingsTab() {
    const { t } = useTranslation();
    // Team management is always for the authenticated user's own org (invites/members),
    // not the currently selected foreign workspace.
    const { authUserId, isForeignWorkspace } = useActiveWorkspace();
    const userId = authUserId;
    const { data: org, isLoading } = useMyOrganization(userId);
    const { create, isPending: creating } = useCreateInvite();
    const { redeem, isPending: redeeming } = useRedeemInvite();
    const { remove, isPending: removing } = useRemoveMember();
    const revokeInvite = useRevokeOrgInvite(userId);

    const [lastToken, setLastToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [redeemCode, setRedeemCode] = useState('');
    const [errorKey, setErrorKey] = useState<string | null>(null);
    const [successKey, setSuccessKey] = useState<string | null>(null);

    const activeInvites = (org?.invites ?? []).filter(
        (i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date(),
    );
    const members = org?.members ?? [];
    const seatsUsed = members.length + activeInvites.length;
    const seatLimit = org?.seat_limit ?? 1;
    const seatsFull = seatsUsed >= seatLimit;
    const iAmOrgOwner = !org || org.owner_id === userId;

    const handleCreate = async () => {
        setErrorKey(null);
        setSuccessKey(null);
        const res = await create();
        if (res.error) {
            setErrorKey(res.error);
            return;
        }
        setLastToken(res.token);
        setSuccessKey('inviteCreated');
    };

    const handleCopy = async (token: string) => {
        try {
            await navigator.clipboard.writeText(token);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setErrorKey('generic');
        }
    };

    const handleRedeem = async () => {
        setErrorKey(null);
        setSuccessKey(null);
        if (!redeemCode.trim()) return;
        const res = await redeem(redeemCode);
        if (res.error) {
            setErrorKey(res.error);
            return;
        }
        setRedeemCode('');
        setSuccessKey('joined');
    };

    const handleRemove = async (memberId: string) => {
        if (!org) return;
        setErrorKey(null);
        const res = await remove(org.id, memberId);
        if (res.error) setErrorKey(res.error);
    };

    const handleRevoke = async (inviteId: string) => {
        setErrorKey(null);
        try {
            await revokeInvite.mutateAsync(inviteId);
        } catch {
            setErrorKey('generic');
        }
    };

    const errMsg = errorKey
        ? t(`settings.tabs.team.errors.${errorKey}`, { defaultValue: t('settings.tabs.team.errors.generic') })
        : null;
    const okMsg = successKey ? t(`settings.tabs.team.success.${successKey}`) : null;

    return (
        <div className="grid gap-4">
            {isForeignWorkspace && (
                <div className="text-[13px] px-3 py-2 rounded-lg bg-[#F3F4F6] dark:bg-[#262b31] text-[#6B7280] dark:text-[#999]">
                    {t('settings.tabs.team.ownOrgNote')}
                </div>
            )}
            {(errMsg || okMsg) && (
                <div
                    className={`text-[13px] px-3 py-2 rounded-lg ${
                        errMsg
                            ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                            : 'bg-palette-teal/10 text-palette-teal'
                    }`}
                >
                    {errMsg ?? okMsg}
                </div>
            )}

            <SectionCard>
                <SectionCard.Header
                    icon={<Users size={16} strokeWidth={1.8} />}
                    title={t('settings.tabs.team.membersTitle')}
                    description={t('settings.tabs.team.membersDescription', {
                        count: members.length,
                        limit: org?.seat_limit ?? '—',
                    })}
                />
                <SectionCard.Body className="flex flex-col gap-2">
                    {isLoading && <p className="text-[13px] text-[#6B7280] dark:text-[#999]">{t('common.loading')}</p>}
                    {!isLoading && members.length === 0 && (
                        <p className="text-[13px] text-[#6B7280] dark:text-[#999]">
                            {t('settings.tabs.team.noMembers')}
                        </p>
                    )}
                    {members.map((m) => {
                        const label = m.display_name || m.business_name || m.user_id.slice(0, 8);
                        const isSelf = m.user_id === userId;
                        const canRemove = m.role !== 'owner' && (iAmOrgOwner || isSelf);
                        return (
                            <SettingsOptionRow key={m.user_id} tone="muted">
                                <div className="flex items-center justify-between w-full gap-2">
                                    <div className="min-w-0">
                                        <span className={settingsOptionLabelCls}>{label}</span>
                                        <span className="ml-2 text-[11px] uppercase tracking-wide text-[#9CA3AF]">
                                            {m.role}
                                            {isSelf ? ` · ${t('settings.tabs.team.you')}` : ''}
                                        </span>
                                    </div>
                                    {canRemove && (
                                        <button
                                            type="button"
                                            disabled={removing}
                                            onClick={() => void handleRemove(m.user_id)}
                                            className="p-1.5 rounded-md text-[#9CA3AF] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 border-none bg-transparent cursor-pointer"
                                            aria-label={t('settings.tabs.team.removeMember')}
                                        >
                                            <UserMinus size={14} />
                                        </button>
                                    )}
                                </div>
                            </SettingsOptionRow>
                        );
                    })}
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header
                    icon={<Copy size={16} strokeWidth={1.8} />}
                    title={t('settings.tabs.team.inviteTitle')}
                    description={t('settings.tabs.team.inviteDescription')}
                />
                <SectionCard.Body className="flex flex-col gap-3">
                    <button
                        type="button"
                        disabled={creating || seatsFull}
                        onClick={() => void handleCreate()}
                        className={primaryBtnCls}
                        title={seatsFull ? t('settings.tabs.team.errors.seat_limit') : undefined}
                    >
                        {creating ? t('common.loading') : t('settings.tabs.team.createInvite')}
                    </button>
                    {seatsFull && (
                        <p className="text-[12px] text-[#6B7280] dark:text-[#999] m-0">
                            {t('settings.tabs.team.errors.seat_limit')}
                        </p>
                    )}
                    {lastToken && (
                        <SettingsOptionRow tone="muted">
                            <div className="flex items-center gap-2 w-full min-w-0">
                                <code className="text-[12px] font-mono truncate flex-1">{lastToken}</code>
                                <button
                                    type="button"
                                    onClick={() => void handleCopy(lastToken)}
                                    className={actionBtnCls}
                                >
                                    {copied ? <Check size={14} /> : <Copy size={14} />}
                                    {copied ? t('settings.tabs.team.copied') : t('settings.tabs.team.copy')}
                                </button>
                            </div>
                        </SettingsOptionRow>
                    )}
                    {activeInvites.length > 0 && (
                        <div className="flex flex-col gap-2 mt-1">
                            <span className="text-[12px] font-medium text-[#6B7280] dark:text-[#999]">
                                {t('settings.tabs.team.activeInvites')}
                            </span>
                            {activeInvites.map((inv) => (
                                <SettingsOptionRow key={inv.id} tone="muted">
                                    <div className="flex items-center gap-2 w-full min-w-0">
                                        <code className="text-[11px] font-mono truncate flex-1">{inv.token}</code>
                                        <button
                                            type="button"
                                            onClick={() => void handleCopy(inv.token)}
                                            className="p-1.5 rounded-md border-none bg-transparent text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white cursor-pointer"
                                            aria-label={t('settings.tabs.team.copy')}
                                        >
                                            <Copy size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void handleRevoke(inv.id)}
                                            className="p-1.5 rounded-md border-none bg-transparent text-[#9CA3AF] hover:text-red-600 cursor-pointer"
                                            aria-label={t('settings.tabs.team.revoke')}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </SettingsOptionRow>
                            ))}
                        </div>
                    )}
                </SectionCard.Body>
            </SectionCard>

            <SectionCard>
                <SectionCard.Header
                    icon={<Users size={16} strokeWidth={1.8} />}
                    title={t('settings.tabs.team.joinTitle')}
                    description={t('settings.tabs.team.joinDescription')}
                />
                <SectionCard.Body className="flex flex-col gap-3">
                    <input
                        type="text"
                        value={redeemCode}
                        onChange={(e) => setRedeemCode(e.target.value)}
                        placeholder={t('settings.tabs.team.redeemPlaceholder')}
                        className="w-full px-3 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#181d21] text-[13px] text-[#111827] dark:text-[#e5e5e5] outline-none focus:border-palette-teal/50"
                    />
                    <button
                        type="button"
                        disabled={redeeming || !redeemCode.trim()}
                        onClick={() => void handleRedeem()}
                        className={primaryBtnCls}
                    >
                        {redeeming ? t('common.loading') : t('settings.tabs.team.redeem')}
                    </button>
                </SectionCard.Body>
            </SectionCard>
        </div>
    );
}
