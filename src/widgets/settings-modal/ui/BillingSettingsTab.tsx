import { useActiveWorkspace } from '@entities/organization';
import { useProfile } from '@entities/profile';
import { useCompletedSessionCount } from '@entities/roast';
import { isPaidPlan, TRIAL_BATCH_CAP, trialEndsAt } from '@shared/lib/features';
import { logger } from '@shared/lib/logger';
import { Badge } from '@shared/ui/Badge';
import { SectionCard } from '@shared/ui/SectionCard';
import { openUrl } from '@tauri-apps/plugin-opener';
import { CreditCard, Mail, Settings, Star } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const CONTACT_EMAIL = 'contact@firstcrackiscoming.com';
const COMPARE_PLANS_URL = 'https://firstcrackiscoming.com/compare-plans';

type Plan = {
    key: string;
    name: string;
    upgrade?: boolean;
    contact?: boolean;
    descKey: string;
};

const PLANS: Plan[] = [
    {
        key: 'pro',
        name: 'Pro',
        upgrade: true,
        descKey: 'settings.tabs.billing.proDesc',
    },
    {
        key: 'pro_plus',
        name: 'Pro+',
        upgrade: true,
        descKey: 'settings.tabs.billing.proPlusDesc',
    },
    {
        key: 'enterprise',
        name: 'Enterprise',
        contact: true,
        descKey: 'settings.tabs.billing.enterpriseDesc',
    },
];

function PlanCard({ plan, isCurrent }: { plan: Plan; isCurrent: boolean }) {
    const { t } = useTranslation();
    const badgeLabel = isCurrent ? t('settings.tabs.billing.current') : t('settings.tabs.billing.available');
    const canUpgrade = !isCurrent && !!plan.upgrade;
    const canContact = !isCurrent && !!plan.contact;
    const cardBorder = isCurrent
        ? 'border-palette-teal/35 bg-palette-teal/[0.07] dark:bg-palette-teal/[0.1]'
        : 'border-[#E5E7EB] dark:border-[#585d61] bg-[#F9FAFB] dark:bg-[#262b31]';

    const handleUpgrade = async () => {
        try {
            await openUrl(COMPARE_PLANS_URL);
        } catch (err) {
            logger.capture(err, { context: 'billing open compare plans' });
        }
    };

    const handleContact = async () => {
        try {
            await openUrl(`mailto:${CONTACT_EMAIL}?subject=Enterprise%20plan`);
        } catch (err) {
            logger.capture(err, { context: 'billing contact enterprise' });
        }
    };

    return (
        <div className={`flex flex-col rounded-xl p-4 border ${cardBorder}`}>
            <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-semibold tracking-wider text-[#9CA3AF] dark:text-[#666] uppercase">
                        {badgeLabel}
                    </div>
                    {isCurrent && (
                        <Badge
                            size="sm"
                            className="text-[9px] font-bold text-palette-teal bg-palette-teal/15"
                            icon={<Star size={10} fill="currentColor" />}
                            aria-label={t('settings.tabs.billing.currentPlan')}
                        />
                    )}
                </div>
                <div className="mb-1">
                    <span className="text-[18px] font-bold text-[#111827] dark:text-[#e5e5e5]">{plan.name}</span>
                </div>
                <div className="text-[12px] text-[#6B7280] dark:text-[#999] mb-3">{t(plan.descKey)}</div>
            </div>
            <div className="mt-auto">
                {isCurrent ? (
                    <button
                        type="button"
                        disabled
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#181d21] text-[12px] font-medium text-[#6B7280] dark:text-[#999] cursor-default"
                    >
                        <Settings size={12} strokeWidth={2} />
                        {t('settings.tabs.billing.current')}
                    </button>
                ) : canUpgrade ? (
                    <button
                        type="button"
                        onClick={() => void handleUpgrade()}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-palette-teal/15 text-palette-teal border border-palette-teal/30 text-[12px] font-semibold hover:bg-palette-teal/25 active:bg-palette-teal/30 transition-all cursor-pointer"
                    >
                        <CreditCard size={12} strokeWidth={2} />
                        {t('settings.tabs.billing.upgrade')}
                    </button>
                ) : canContact ? (
                    <button
                        type="button"
                        onClick={() => void handleContact()}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-palette-teal/15 text-palette-teal border border-palette-teal/30 text-[12px] font-semibold hover:bg-palette-teal/25 active:bg-palette-teal/30 transition-all cursor-pointer"
                    >
                        <Mail size={12} strokeWidth={2} />
                        {t('settings.tabs.billing.contact')}
                    </button>
                ) : null}
            </div>
        </div>
    );
}

/** Current non-paid state: active trial (days/batches left, derived like the server) or read-only. */
function PlanStateCard({
    plan,
    createdAt,
    completedCount,
}: {
    plan: string;
    createdAt: string;
    completedCount: number;
}) {
    const { t } = useTranslation();
    const [nowMs] = useState(() => Date.now());
    const daysLeft = Math.max(0, Math.ceil((trialEndsAt(createdAt).getTime() - nowMs) / 86_400_000));
    const batchesLeft = Math.max(0, TRIAL_BATCH_CAP - completedCount);
    const trialActive = plan !== 'read_only' && daysLeft > 0 && batchesLeft > 0;

    return (
        <div className="flex flex-col rounded-xl p-4 border border-palette-teal/35 bg-palette-teal/[0.07] dark:bg-palette-teal/[0.1]">
            <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-semibold tracking-wider text-[#9CA3AF] dark:text-[#666] uppercase">
                    {t('settings.tabs.billing.current')}
                </div>
                <Badge
                    size="sm"
                    className="text-[9px] font-bold text-palette-teal bg-palette-teal/15"
                    icon={<Star size={10} fill="currentColor" />}
                    aria-label={t('settings.tabs.billing.currentPlan')}
                />
            </div>
            <div className="mb-1">
                <span className="text-[18px] font-bold text-[#111827] dark:text-[#e5e5e5]">
                    {trialActive ? t('settings.tabs.billing.trial') : t('settings.tabs.billing.readOnly')}
                </span>
            </div>
            {trialActive && (
                <div className="text-[12px] font-medium text-palette-teal mb-1">
                    {t('settings.tabs.billing.trialStatus', { days: daysLeft, batches: batchesLeft })}
                </div>
            )}
            <div className="text-[12px] text-[#6B7280] dark:text-[#999]">
                {trialActive ? t('settings.tabs.billing.trialDesc') : t('settings.tabs.billing.readOnlyDesc')}
            </div>
        </div>
    );
}

export function BillingSettingsTab() {
    const { t } = useTranslation();
    // Plan/usage must mirror the server batch gate, which reads the workspace
    // owner's profile — not the signed-in member's (issue #154).
    const { workspaceOwnerId, isForeignWorkspace, isWorkspaceReady } = useActiveWorkspace();
    const { data: profile } = useProfile(workspaceOwnerId);
    const { data: completedCount } = useCompletedSessionCount(workspaceOwnerId);
    const currentPlan = profile?.plan ?? '';

    return (
        <SectionCard className="self-start">
            <SectionCard.Header
                title={t('settings.tabs.billing.currentPlan')}
                description={isForeignWorkspace ? t('settings.tabs.billing.workspaceNote') : undefined}
            />
            <SectionCard.Body className="grid grid-cols-2 gap-3 items-stretch">
                {!isWorkspaceReady ? (
                    [0, 1].map((i) => (
                        <div
                            key={i}
                            className="h-40 rounded-xl border border-[#E5E7EB] dark:border-[#585d61] bg-[#F9FAFB] dark:bg-[#262b31] animate-pulse"
                            aria-hidden
                        />
                    ))
                ) : (
                    <>
                        {profile && !isPaidPlan(currentPlan) && (
                            <PlanStateCard
                                plan={currentPlan}
                                createdAt={profile.created_at}
                                completedCount={completedCount ?? 0}
                            />
                        )}
                        {PLANS.map((plan) => (
                            <PlanCard key={plan.key} plan={plan} isCurrent={currentPlan === plan.key} />
                        ))}
                    </>
                )}
            </SectionCard.Body>
        </SectionCard>
    );
}
