import { type ChannelPlatform, useConnectChannel } from '@entities/sales-channel';
import { useAuthStore } from '@shared/store/auth';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const inputCls =
    'w-full px-3.5 py-3 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all';

type Props = {
    open: boolean;
    platform: ChannelPlatform | null;
    onClose: () => void;
};

export const ConnectChannelModal = ({ open, platform, onClose }: Props) => {
    const { t } = useTranslation();
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const connect = useConnectChannel(userId);
    const [displayName, setDisplayName] = useState('');
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [shop, setShop] = useState('');
    const [accessToken, setAccessToken] = useState('');
    const [mallId, setMallId] = useState('');
    const [error, setError] = useState<string | null>(null);

    if (!open || !platform) return null;

    const reset = () => {
        setDisplayName('');
        setClientId('');
        setClientSecret('');
        setShop('');
        setAccessToken('');
        setMallId('');
        setError(null);
    };

    const handleClose = () => {
        reset();
        onClose();
    };

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
            handleClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <ModalShell
            onClose={handleClose}
            labelledBy="connect-channel-title"
            contentClassName="max-w-[480px] w-full max-h-[min(720px,calc(100vh-64px))] flex flex-col rounded-[16px] bg-[rgba(255,255,255,0.96)] dark:bg-[#181d21] dark:[&_*]:!text-white backdrop-[blur(20px)_saturate(180%)] shadow-[0_32px_80px_rgba(22,18,12,0.25)] border border-white dark:border-[#585d61] overflow-hidden"
        >
            <ModalHeader
                titleId="connect-channel-title"
                title={t(`orders.channel.connect.${platform}`)}
                onClose={handleClose}
                closeLabel={t('common.close')}
                className="px-6 pt-5 pb-3"
                titleClassName="text-[15px] font-semibold text-primary m-0"
                closeClassName="w-8 h-8 rounded-lg text-muted flex items-center justify-center hover:bg-surface border-none bg-transparent cursor-pointer"
            />
            <ModalScrollBody className="px-6 pb-6 space-y-4">
                <p className="text-[12px] leading-relaxed text-muted">{t(`orders.channel.help.${platform}`)}</p>

                <label className="block space-y-1.5">
                    <span className="text-[12px] text-secondary">{t('orders.channel.displayName')}</span>
                    <input
                        className={inputCls}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={t('orders.channel.displayNamePh')}
                    />
                </label>

                {platform === 'naver' && (
                    <>
                        <label className="block space-y-1.5">
                            <span className="text-[12px] text-secondary">Client ID</span>
                            <input
                                className={inputCls}
                                value={clientId}
                                onChange={(e) => setClientId(e.target.value)}
                                autoComplete="off"
                            />
                        </label>
                        <label className="block space-y-1.5">
                            <span className="text-[12px] text-secondary">Client Secret</span>
                            <input
                                className={inputCls}
                                type="password"
                                value={clientSecret}
                                onChange={(e) => setClientSecret(e.target.value)}
                                autoComplete="off"
                            />
                        </label>
                    </>
                )}

                {platform === 'shopify' && (
                    <>
                        <label className="block space-y-1.5">
                            <span className="text-[12px] text-secondary">{t('orders.channel.shopDomain')}</span>
                            <input
                                className={inputCls}
                                value={shop}
                                onChange={(e) => setShop(e.target.value)}
                                placeholder="mystore.myshopify.com"
                                autoComplete="off"
                            />
                        </label>
                        <label className="block space-y-1.5">
                            <span className="text-[12px] text-secondary">Admin API access token</span>
                            <input
                                className={inputCls}
                                type="password"
                                value={accessToken}
                                onChange={(e) => setAccessToken(e.target.value)}
                                autoComplete="off"
                            />
                        </label>
                    </>
                )}

                {platform === 'cafe24' && (
                    <>
                        <label className="block space-y-1.5">
                            <span className="text-[12px] text-secondary">Mall ID</span>
                            <input
                                className={inputCls}
                                value={mallId}
                                onChange={(e) => setMallId(e.target.value)}
                                placeholder="yourmall"
                                autoComplete="off"
                            />
                        </label>
                        <label className="block space-y-1.5">
                            <span className="text-[12px] text-secondary">Access token</span>
                            <input
                                className={inputCls}
                                type="password"
                                value={accessToken}
                                onChange={(e) => setAccessToken(e.target.value)}
                                autoComplete="off"
                            />
                        </label>
                    </>
                )}

                {error ? <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p> : null}

                <button
                    type="button"
                    disabled={connect.isPending}
                    onClick={() => void submit()}
                    className="w-full rounded-full bg-primary px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-50"
                >
                    {connect.isPending ? t('orders.channel.connecting') : t('orders.channel.connectCta')}
                </button>
            </ModalScrollBody>
        </ModalShell>
    );
};
