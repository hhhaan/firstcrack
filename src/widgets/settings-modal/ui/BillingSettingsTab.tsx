import { useProfile } from '@entities/profile';
import { supabase } from '@shared/lib/supabase';
import { useAuthStore } from '@shared/store/auth';
import { openUrl } from '@tauri-apps/plugin-opener';
import { CreditCard, Settings, Star } from 'lucide-react';
import { useState } from 'react';

const PLANS = [
    { key: 'free', name: 'Free', price: '$0', interval: '/mo', priceId: '', description: 'Free forever' },
    {
        key: 'pro',
        name: 'Pro',
        price: '$39',
        interval: '/mo',
        priceId: 'POLAR_PRO_PRODUCT_ID',
        description: 'Full access to all features',
    },
    {
        key: 'enterprise',
        name: 'Enterprise',
        price: '$89',
        interval: '/mo',
        priceId: 'POLAR_ENTERPRISE_PRODUCT_ID',
        description: 'Priority support & custom limits',
    },
];

function PlanCard({
    plan,
    isActive,
    checkoutLoading,
    onUpgrade,
}: {
    plan: (typeof PLANS)[number];
    isActive: boolean;
    checkoutLoading: boolean;
    onUpgrade: (priceId: string) => void;
}) {
    const badgeLabel = isActive ? 'Current' : plan.key === 'free' ? 'Free' : 'Available';
    const cardBorder = isActive
        ? 'border-palette-lavender/40 bg-palette-lavender/[0.06] dark:bg-palette-lavender/[0.08]'
        : 'border-[#E5E7EB] dark:border-[#585d61] bg-[#F9FAFB] dark:bg-[#262b31]';

    return (
        <div className={`rounded-xl p-4 border ${cardBorder}`}>
            <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-semibold tracking-wider text-[#9CA3AF] dark:text-[#666] uppercase">
                    {badgeLabel}
                </div>
                {isActive && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-palette-lavender/15 text-palette-lavender">
                        <Star size={10} fill="currentColor" />
                    </span>
                )}
            </div>
            <div className="flex items-baseline gap-1.5 mb-1">
                <span className="text-[18px] font-bold text-[#111827] dark:text-[#e5e5e5]">{plan.name}</span>
                <span className="text-[13px] text-[#6B7280] dark:text-[#999]">
                    {plan.price}
                    {plan.interval}
                </span>
            </div>
            <div className="text-[12px] text-[#6B7280] dark:text-[#999] mb-3">{plan.description}</div>
            {isActive ? (
                <button
                    type="button"
                    disabled
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#181d21] text-[12px] font-medium text-[#6B7280] dark:text-[#999] cursor-default"
                >
                    <Settings size={12} strokeWidth={2} />
                    Current
                </button>
            ) : plan.key === 'free' ? null : (
                <button
                    type="button"
                    onClick={() => onUpgrade(plan.priceId)}
                    disabled={checkoutLoading}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-palette-lavender text-white text-[12px] font-semibold hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-all cursor-pointer"
                >
                    <CreditCard size={12} strokeWidth={2} />
                    {checkoutLoading ? 'Redirecting…' : 'Upgrade'}
                </button>
            )}
        </div>
    );
}

export function BillingSettingsTab() {
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
            console.error('[BillingSettingsTab] checkout failed:', err);
        } finally {
            setCheckoutLoading(false);
        }
    };

    const currentPlan = (profile?.plan ?? 'free') as string;

    return (
        <div className="grid gap-4">
            <section className="bg-white dark:bg-[#181d21] border border-[#E5E7EB] dark:border-[#585d61] rounded-xl p-5">
                <h4 className="text-[15px] font-semibold text-[#111827] dark:text-[#e5e5e5] m-0 mb-4">Current Plan</h4>
                <div className="grid grid-cols-3 gap-3">
                    {PLANS.map((plan) => (
                        <PlanCard
                            key={plan.key}
                            plan={plan}
                            isActive={currentPlan === plan.key}
                            checkoutLoading={checkoutLoading}
                            onUpgrade={handleUpgrade}
                        />
                    ))}
                </div>
            </section>
        </div>
    );
}
