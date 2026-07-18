import { type ChannelPlatform, useConnectChannel } from '@entities/sales-channel';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { useAuthStore } from '@shared/store/auth';
import { Badge } from '@shared/ui/Badge';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const PLATFORM_EN: Record<string, string> = {
    naver: 'Naver',
    cafe24: 'Cafe24',
    shopify: 'Shopify',
};

type Props = {
    open: boolean;
    platform: ChannelPlatform | null;
    onClose: () => void;
};

export const ConnectChannelModal = ({ open, platform, onClose }: Props) => {
    const { t } = useTranslation();
    // Channel credentials are personal (Edge Function writes under auth.uid()).
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const connect = useConnectChannel(userId);
    const [displayName, setDisplayName] = useState('');
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [shop, setShop] = useState('');
    const [accessToken, setAccessToken] = useState('');
    const [mallId, setMallId] = useState('');
    const [error, setError] = useState<string | null>(null);

    useFormEscape(open, onClose);

    useEffect(() => {
        if (!open) return;
        setDisplayName('');
        setClientId('');
        setClientSecret('');
        setShop('');
        setAccessToken('');
        setMallId('');
        setError(null);
    }, [open, platform]);

    if (!open || !platform) return null;

    const submit = async () => {
        setError(null);
        try {
            if (platform === 'naver') {
                if (!clientId.trim() || !clientSecret.trim()) {
                    setError(t('orders.channel.errRequired'));
                    return;
                }
                await connect.mutateAsync({
                    platform,
                    credentials: { client_id: clientId.trim(), client_secret: clientSecret.trim() },
                    displayName: displayName.trim() || undefined,
                });
            } else if (platform === 'shopify') {
                if (!shop.trim() || !accessToken.trim()) {
                    setError(t('orders.channel.errRequired'));
                    return;
                }
                await connect.mutateAsync({
                    platform,
                    credentials: { shop: shop.trim(), access_token: accessToken.trim() },
                    displayName: displayName.trim() || undefined,
                });
            } else {
                if (!mallId.trim() || !accessToken.trim()) {
                    setError(t('orders.channel.errRequired'));
                    return;
                }
                await connect.mutateAsync({
                    platform,
                    credentials: { mall_id: mallId.trim(), access_token: accessToken.trim() },
                    displayName: displayName.trim() || undefined,
                });
            }
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <ModalShell onClose={onClose} labelledBy="connect-channel-title" contentClassName={modalPanel.formSm}>
            <div className="shrink-0 border-b border-black/4 bg-white/60 dark:border-[#585d61] dark:bg-[#1a1e23]">
                <ModalHeader
                    titleId="connect-channel-title"
                    title={t(`orders.channel.connect.${platform}`)}
                    subtitle={
                        <div className="mt-2">
                            <Badge tone="soft" size="sm">
                                {(platform && PLATFORM_EN[platform]) ?? platform}
                            </Badge>
                        </div>
                    }
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <ModalScrollBody contentClassName="p-8 space-y-4">
                <div className="flex gap-2.5 rounded-xl bg-surface-warm-solid px-3.5 py-3 dark:bg-surface-elevated">
                    <Info size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-muted" />
                    <p className="text-[12px] leading-relaxed text-muted tracking-[0.14px]">
                        {t(`orders.channel.help.${platform}`)}
                    </p>
                </div>

                <div>
                    <label className={labelCls} htmlFor="channel-display-name">
                        {t('orders.channel.displayName')}
                    </label>
                    <input
                        id="channel-display-name"
                        className={inputCls}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={t('orders.channel.displayNamePh')}
                    />
                </div>

                {platform === 'naver' && (
                    <>
                        <div>
                            <label className={labelCls} htmlFor="channel-client-id">
                                {t('orders.channel.clientId')}
                            </label>
                            <input
                                id="channel-client-id"
                                className={inputCls}
                                value={clientId}
                                onChange={(e) => setClientId(e.target.value)}
                                autoComplete="off"
                            />
                        </div>
                        <div>
                            <label className={labelCls} htmlFor="channel-client-secret">
                                {t('orders.channel.clientSecret')}
                            </label>
                            <input
                                id="channel-client-secret"
                                className={inputCls}
                                type="password"
                                value={clientSecret}
                                onChange={(e) => setClientSecret(e.target.value)}
                                autoComplete="off"
                            />
                        </div>
                    </>
                )}

                {platform === 'shopify' && (
                    <>
                        <div>
                            <label className={labelCls} htmlFor="channel-shop-domain">
                                {t('orders.channel.shopDomain')}
                            </label>
                            <input
                                id="channel-shop-domain"
                                className={inputCls}
                                value={shop}
                                onChange={(e) => setShop(e.target.value)}
                                placeholder="mystore.myshopify.com"
                                autoComplete="off"
                            />
                        </div>
                        <div>
                            <label className={labelCls} htmlFor="channel-access-token">
                                {t('orders.channel.accessToken')}
                            </label>
                            <input
                                id="channel-access-token"
                                className={inputCls}
                                type="password"
                                value={accessToken}
                                onChange={(e) => setAccessToken(e.target.value)}
                                autoComplete="off"
                            />
                        </div>
                    </>
                )}

                {platform === 'cafe24' && (
                    <>
                        <div>
                            <label className={labelCls} htmlFor="channel-mall-id">
                                {t('orders.channel.mallId')}
                            </label>
                            <input
                                id="channel-mall-id"
                                className={inputCls}
                                value={mallId}
                                onChange={(e) => setMallId(e.target.value)}
                                placeholder="yourmall"
                                autoComplete="off"
                            />
                        </div>
                        <div>
                            <label className={labelCls} htmlFor="channel-access-token">
                                {t('orders.channel.accessToken')}
                            </label>
                            <input
                                id="channel-access-token"
                                className={inputCls}
                                type="password"
                                value={accessToken}
                                onChange={(e) => setAccessToken(e.target.value)}
                                autoComplete="off"
                            />
                        </div>
                    </>
                )}

                {error ? (
                    <p className="rounded-lg bg-[rgba(192,57,43,0.07)] px-3 py-2 text-[12px] leading-relaxed text-[#c0392b] tracking-[0.14px]">
                        {error}
                    </p>
                ) : null}

                <div className="!mt-8 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 rounded-full border-none bg-surface py-3 text-[14px] font-medium tracking-[0.14px] text-secondary shadow-(--shadow-inset) transition-colors hover:bg-surface-elevated cursor-pointer dark:bg-surface-elevated dark:text-[#e5e5e5]"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={connect.isPending}
                        onClick={() => void submit()}
                        className="flex-1 rounded-full border border-transparent bg-primary py-3 text-[14px] font-medium tracking-[0.14px] text-white transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 dark:border-white dark:bg-[#0d0d0d] cursor-pointer"
                    >
                        {connect.isPending ? t('orders.channel.connecting') : t('orders.channel.connectCta')}
                    </button>
                </div>
            </ModalScrollBody>
        </ModalShell>
    );
};
