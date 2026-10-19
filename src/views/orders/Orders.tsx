import { FEATURE, useFeature } from '@shared/lib/features';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChannelsTab } from './ui/ChannelsTab';
import { OrdersTab } from './ui/OrdersTab';
import { ProductsTab } from './ui/ProductsTab';

type OrdersProps = { onUpgrade?: () => void };
type Tab = 'orders' | 'products' | 'channels';

export const Orders = ({ onUpgrade }: OrdersProps) => {
    const { t } = useTranslation();
    const canOrders = useFeature(FEATURE.orderIntegration);
    const [tab, setTab] = useState<Tab>('orders');

    if (!canOrders) {
        return (
            <PageLayout>
                <PageHeader title={t('orders.title')} subtitle={t('orders.locked.subtitle')} />
                <div className="flex flex-col items-center justify-center gap-5 rounded-2xl border border-border bg-main-bg px-6 py-20 text-center dark:border-border">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted dark:bg-surface-elevated">
                        <Lock size={22} strokeWidth={1.5} />
                    </div>
                    <div>
                        <p className="text-[15px] font-medium text-primary tracking-[0.14px]">
                            {t('orders.locked.title')}
                        </p>
                        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted tracking-[0.14px]">
                            {t('orders.locked.description')}
                        </p>
                    </div>
                    {onUpgrade ? <PillButton onClick={onUpgrade}>{t('orders.locked.cta')}</PillButton> : null}
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <PageHeader title={t('orders.title')} subtitle={t('orders.subtitle')} />

            <div className="mb-6 flex gap-1 border-b border-border-subtle dark:border-border">
                {(['orders', 'products', 'channels'] as Tab[]).map((id) => {
                    const active = tab === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setTab(id)}
                            className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium tracking-[0.14px] transition-colors cursor-pointer ${
                                active
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted hover:text-secondary'
                            }`}
                        >
                            {t(`orders.tab.${id}`)}
                        </button>
                    );
                })}
            </div>

            {tab === 'orders' ? <OrdersTab /> : tab === 'products' ? <ProductsTab /> : <ChannelsTab />}
        </PageLayout>
    );
};
