import { useActiveWorkspace } from '@entities/organization';
import {
    type ChannelPlatform,
    useConnectChannel,
    useSalesChannels,
    useStartCafe24OAuth,
} from '@entities/sales-channel';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { Badge } from '@shared/ui/Badge';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Info } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCafe24OAuthWait } from '../model/useCafe24OAuthWait';

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
    // Connections are workspace-owned rows (RLS: has_workspace_access(user_id)) — key by
    // the workspace owner so the list, the cache and the OAuth poll all read the same rows.
    const { workspaceOwnerId: userId, isWorkspaceReady } = useActiveWorkspace();
    const connect = useConnectChannel(userId);
    const startCafe24 = useStartCafe24OAuth();
    const { data: channelData, refetch } = useSalesChannels(userId);
    const [displayName, setDisplayName] = useState('');
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [shop, setShop] = useState('');
    const [accessToken, setAccessToken] = useState('');
    const [webhookSecret, setWebhookSecret] = useState('');
    const [mallId, setMallId] = useState('');
    const [error, setError] = useState<string | null>(null);

    const channels = useMemo(() => channelData ?? [], [channelData]);
    const refetchChannels = useCallback(() => {
        void refetch();
    }, [refetch]);
    const oauthWait = useCafe24OAuthWait({
        enabled: open && platform === 'cafe24',
        mallId,
        channels,
        refetchChannels,
        onConnected: onClose,
    });
    const cafe24Waiting = oauthWait.waiting;
    const { stop: stopOauthWait } = oauthWait;

    useFormEscape(open, onClose);

    // biome-ignore lint/correctness/useExhaustiveDependencies: reset when platform changes while open
    useEffect(() => {
        if (!open) return;
        setDisplayName('');
        setClientId('');
        setClientSecret('');
        setShop('');
        setAccessToken('');
        setWebhookSecret('');
        setMallId('');
        setError(null);
        stopOauthWait();
    }, [open, platform, stopOauthWait]);

    if (!open || !platform) return null;

    const submit = async () => {
        setError(null);
        stopOauthWait();
        if (!isWorkspaceReady || !userId) {
            setError(t('orders.channel.errWorkspaceLoading'));
            return;
        }
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
                    workspaceOwnerId: userId,
                });
                onClose();
            } else if (platform === 'shopify') {
                if (!shop.trim() || !accessToken.trim()) {
                    setError(t('orders.channel.errRequired'));
                    return;
                }
                await connect.mutateAsync({
                    platform,
                    credentials: {
                        shop: shop.trim(),
                        access_token: accessToken.trim(),
                        webhook_secret: webhookSecret.trim() || undefined,
                    },
                    displayName: displayName.trim() || undefined,
                    workspaceOwnerId: userId,
                });
                onClose();
            } else {
                if (!mallId.trim()) {
                    setError(t('orders.channel.errRequired'));
                    return;
                }
                const { authorizeUrl } = await startCafe24.mutateAsync({
                    mallId: mallId.trim(),
                    displayName: displayName.trim() || undefined,
                    workspaceOwnerId: userId,
                });
                oauthWait.start();
                await openUrl(authorizeUrl);
            }
        } catch (e) {
            oauthWait.stop();
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    const errorText = error ?? (oauthWait.timedOut ? t('orders.channel.oauthWaitTimeout') : null);

    const pending = platform === 'cafe24' ? startCafe24.isPending || cafe24Waiting : connect.isPending;
    const ctaLabel =
        platform === 'cafe24'
            ? cafe24Waiting
                ? t('orders.channel.oauthWaiting')
                : t('orders.channel.oauthCta')
            : connect.isPending
              ? t('orders.channel.connecting')
              : t('orders.channel.connectCta');

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
                        disabled={cafe24Waiting}
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
                        <div>
                            <label className={labelCls} htmlFor="channel-webhook-secret">
                                {t('orders.channel.webhookSecret')}
                            </label>
                            <input
                                id="channel-webhook-secret"
                                className={inputCls}
                                type="password"
                                value={webhookSecret}
                                onChange={(e) => setWebhookSecret(e.target.value)}
                                autoComplete="off"
                            />
                            <p className="mt-1.5 text-[11px] leading-relaxed text-muted tracking-[0.14px]">
                                {t('orders.channel.webhookSecretHelp')}
                            </p>
                        </div>
                    </>
                )}

                {platform === 'cafe24' && (
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
                            disabled={cafe24Waiting}
                        />
                    </div>
                )}

                {errorText ? (
                    <p className="rounded-lg bg-[rgba(192,57,43,0.07)] px-3 py-2 text-[12px] leading-relaxed text-[#c0392b] tracking-[0.14px]">
                        {errorText}
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
                        disabled={pending}
                        onClick={() => void submit()}
                        className="flex-1 rounded-full border border-transparent bg-primary py-3 text-[14px] font-medium tracking-[0.14px] text-white transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 dark:border-white dark:bg-[#0d0d0d] cursor-pointer"
                    >
                        {ctaLabel}
                    </button>
                </div>
            </ModalScrollBody>
        </ModalShell>
    );
};
