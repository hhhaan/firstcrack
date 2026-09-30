import { useActiveWorkspace } from '@entities/organization';
import { useProfile } from '@entities/profile';
import { useCompletedSessionCount } from '@entities/roast';
import { isPaidPlan, TRIAL_BATCH_CAP, trialEndsAt } from '@shared/lib/features';
import { logger } from '@shared/lib/logger';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsSection } from './SettingsSection';

const CONTACT_EMAIL = 'contact@firstcrackiscoming.com';
const COMPARE_PLANS_URL = 'https://firstcrackiscoming.com/compare-plans';

const PLAN_NAMES: Record<string, string> = {
    pro: 'Pro',
    pro_plus: 'Pro+',
    enterprise: 'Enterprise',
    team: 'Enterprise',
    tester: 'Tester',
};

const PLAN_DESC: Record<string, string> = {
    pro: 'settings.tabs.billing.proDesc',
    pro_plus: 'settings.tabs.billing.proPlusDesc',
    enterprise: 'settings.tabs.billing.enterpriseDesc',
    team: 'settings.tabs.billing.enterpriseDesc',
    tester: 'settings.tabs.billing.enterpriseDesc',
};

function OutlineButton({
    children,
    disabled,
    onClick,
}: {
    children: string;
    disabled?: boolean;
    onClick?: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="inline-flex h-8 cursor-pointer items-center rounded-full border border-border bg-transparent px-3.5 text-[13px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
            {children}
        </button>
    );
}

function TextButton({ children, disabled, onClick }: { children: string; disabled?: boolean; onClick?: () => void }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="inline-flex h-8 cursor-pointer items-center px-1 text-[13px] font-medium text-secondary transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
            {children}
        </button>
    );
}

export function BillingSettingsTab() {
    const { t } = useTranslation();
    const { workspaceOwnerId, isForeignWorkspace, isWorkspaceReady } = useActiveWorkspace();
    const { data: profile } = useProfile(workspaceOwnerId);
    const { data: completedCount } = useCompletedSessionCount(workspaceOwnerId);
    const currentPlan = profile?.plan ?? '';
    const [nowMs] = useState(() => Date.now());
    const daysLeft = profile
        ? Math.max(0, Math.ceil((trialEndsAt(profile.created_at).getTime() - nowMs) / 86_400_000))
        : 0;
    const batchesLeft = Math.max(0, TRIAL_BATCH_CAP - (completedCount ?? 0));
    const trialActive =
        !!profile && !isPaidPlan(currentPlan) && currentPlan !== 'read_only' && daysLeft > 0 && batchesLeft > 0;
    const planName =
        PLAN_NAMES[currentPlan] ??
        (trialActive ? t('settings.tabs.billing.trial') : t('settings.tabs.billing.readOnly'));
    const detailKey = PLAN_DESC[currentPlan];
    const detail = trialActive
        ? t('settings.tabs.billing.trialStatus', { days: daysLeft, batches: batchesLeft })
        : detailKey
          ? t(detailKey)
          : t('settings.tabs.billing.readOnlyDesc');

    const openCompare = async () => {
        try {
            await openUrl(COMPARE_PLANS_URL);
        } catch (err) {
            logger.capture(err, { context: 'billing open compare plans' });
        }
    };

    const openContact = async () => {
        try {
            await openUrl(`mailto:${CONTACT_EMAIL}?subject=Enterprise%20plan`);
        } catch (err) {
            logger.capture(err, { context: 'billing contact enterprise' });
        }
    };

    return (
        <SettingsSection>
            {isForeignWorkspace && (
                <p className="m-0 text-xs leading-relaxed text-muted">{t('settings.tabs.billing.workspaceNote')}</p>
            )}
            <div className="grid grid-cols-1 items-stretch gap-3 @[560px]:grid-cols-2">
                {!isWorkspaceReady ? (
                    [0, 1].map((i) => (
                        <div
                            key={i}
                            className="h-36 animate-pulse rounded-xl border border-border bg-surface"
                            aria-hidden
                        />
                    ))
                ) : (
                    <>
                        <div className="flex flex-col gap-3 rounded-xl border border-border bg-main-bg p-4">
                            <div className="text-[13px] text-muted">{t('settings.tabs.billing.planCardLabel')}</div>
                            <div className="text-[18px] font-semibold text-primary">{planName}</div>
                            <div className="text-[13px] text-secondary">{detail}</div>
                            <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                                <OutlineButton onClick={() => void openCompare()}>
                                    {t('settings.tabs.billing.changePlan')}
                                </OutlineButton>
                                <TextButton onClick={() => void openContact()}>
                                    {t('settings.tabs.billing.contact')}
                                </TextButton>
                            </div>
                        </div>
                        <div className="flex flex-col gap-3 rounded-xl border border-border bg-main-bg p-4">
                            <div className="text-[13px] text-muted">{t('settings.tabs.billing.credits')}</div>
                            <div className="text-[22px] font-semibold tracking-tight text-primary">—</div>
                            <div className="flex items-center gap-2">
                                <span className="text-[13px] text-secondary">
                                    {t('settings.tabs.billing.creditsPending')}
                                </span>
                                <span className="rounded-full bg-surface px-2.5 py-0.5 text-[12px] font-medium text-muted">
                                    {t('settings.tabs.billing.creditsSettings')}
                                </span>
                            </div>
                            <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                                <OutlineButton disabled>{t('settings.tabs.billing.creditsBuy')}</OutlineButton>
                                <TextButton disabled>{t('settings.tabs.billing.creditsUsage')}</TextButton>
                            </div>
                        </div>
                    </>
                )}
            </div>
            <div className="mt-6">
                <h2 className="m-0 mb-2.5 text-[13px] font-semibold text-primary">
                    {t('settings.tabs.billing.invoices')}
                </h2>
                <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full border-collapse text-left text-[13px]">
                        <thead>
                            <tr className="border-b border-border text-muted">
                                <th className="px-4 py-3 font-medium">{t('settings.tabs.billing.colDate')}</th>
                                <th className="px-4 py-3 font-medium">{t('settings.tabs.billing.colAmount')}</th>
                                <th className="px-4 py-3 font-medium">{t('settings.tabs.billing.colType')}</th>
                                <th className="px-4 py-3 font-medium">{t('settings.tabs.billing.colStatus')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td colSpan={4} className="px-4 py-8 text-center text-muted">
                                    {t('settings.tabs.billing.invoicesEmpty')}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </SettingsSection>
    );
}
