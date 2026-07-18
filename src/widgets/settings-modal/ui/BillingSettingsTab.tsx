import { useProfile } from '@entities/profile';
import { logger } from '@shared/lib/logger';
import { supabase } from '@shared/lib/supabase';
import { useAuthStore } from '@shared/store/auth';
import { Badge } from '@shared/ui/Badge';
import { SectionCard } from '@shared/ui/SectionCard';
import { openUrl } from '@tauri-apps/plugin-opener';
import { CreditCard, Mail, Settings, Star } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const CONTACT_EMAIL = 'contact@firstcrackiscoming.com';

type Plan = {
    key: string;
    name: string;
    priceId?: string;
    contact?: boolean;
    descKey: string;
};

const PLANS: Plan[] = [
    { key: 'free', name: 'Free', descKey: 'settings.tabs.billing.freeDesc' },
    {
        key: 'pro',
        name: 'Pro',
        priceId: 'POLAR_PRO_PRODUCT_ID',
        descKey: 'settings.tabs.billing.proDesc',
    },
    {
        key: 'enterprise',
        name: 'Enterprise',
        contact: true,
        descKey: 'settings.tabs.billing.enterpriseDesc',
    },
];

function PlanCard({
    plan,
    isCurrent,
    checkoutLoading,
    onUpgrade,
}: {
    plan: Plan;
    isCurrent: boolean;
    checkoutLoading: boolean;
    onUpgrade: (priceId: string) => void;
}) {
    const { t } = useTranslation();
    const badgeLabel = isCurrent
        ? t('settings.tabs.billing.current')
        : plan.key === 'free'
          ? t('settings.tabs.billing.free')
          : t('settings.tabs.billing.available');
    const canUpgrade = !isCurrent && !!plan.priceId;
    const canContact = !isCurrent && !!plan.contact;
    const cardBorder = isCurrent
        ? 'border-palette-teal/35 bg-palette-teal/[0.07] dark:bg-palette-teal/[0.1]'
        : 'border-[#E5E7EB] dark:border-[#585d61] bg-[#F9FAFB] dark:bg-[#262b31]';

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
                            aria-label="Current plan"
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
                        onClick={() => onUpgrade(plan.priceId ?? '')}
                        disabled={checkoutLoading}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-palette-teal/15 text-palette-teal border border-palette-teal/30 text-[12px] font-semibold hover:bg-palette-teal/25 active:bg-palette-teal/30 disabled:opacity-50 transition-all cursor-pointer"
                    >
                        <CreditCard size={12} strokeWidth={2} />
                        {checkoutLoading ? t('settings.tabs.billing.redirecting') : t('settings.tabs.billing.upgrade')}
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

export function BillingSettingsTab() {
    const { t } = useTranslation();
    const user = useAuthStore((s) => s.user);
    const { data: profile } = useProfile(user?.id ?? '');
    const [checkoutLoading, setCheckoutLoading] = useState(false);

    const handleUpgrade = async (priceId: string) => {
        setCheckoutLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke<{ url: string }>('create-polar-checkout', {
                body: { priceId },
            });
            if (error || !data?.url) throw error;
            await openUrl(data.url);
        } catch (err) {
            logger.capture(err, { context: 'billing checkout' });
        } finally {
            setCheckoutLoading(false);
        }
    };

    const currentPlan = profile?.plan ?? 'free';

    return (
        <SectionCard className="self-start">
            <SectionCard.Header title={t('settings.tabs.billing.currentPlan')} />
            <SectionCard.Body className="grid grid-cols-3 gap-3 items-stretch">
                {PLANS.map((plan) => (
                    <PlanCard
                        key={plan.key}
                        plan={plan}
                        isCurrent={currentPlan === plan.key}
                        checkoutLoading={checkoutLoading}
                        onUpgrade={handleUpgrade}
                    />
                ))}
            </SectionCard.Body>
        </SectionCard>
    );
}
