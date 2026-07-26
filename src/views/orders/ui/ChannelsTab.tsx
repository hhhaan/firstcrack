import { useActiveWorkspace } from '@entities/organization';
import {
    type ChannelPlatform,
    type SalesChannelConnection,
    useDisconnectChannel,
    useSalesChannels,
    useSetAutoFulfill,
    useSyncOrders,
} from '@entities/sales-channel';
import { formatDateShort } from '@shared/lib/format';
import { Badge } from '@shared/ui/Badge';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { ConnectChannelModal } from '@widgets/connect-channel-modal';
import { Link2, RefreshCw, Store } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChannelsListSkeleton } from './OrdersSkeleton';
import { CHANNEL_STATUS_EN, channelStatusTone, EmptyState, GhostButton, PLATFORM_EN } from './orderUi';

const PLATFORMS: ChannelPlatform[] = ['naver', 'cafe24', 'shopify'];

export function ChannelsTab() {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId, isWorkspaceReady } = useActiveWorkspace();
    const { data: channels = [], isLoading } = useSalesChannels(userId);
    const disconnect = useDisconnectChannel(userId);
    const sync = useSyncOrders(userId);
    const setAutoFulfill = useSetAutoFulfill(userId);
    const [connectPlatform, setConnectPlatform] = useState<ChannelPlatform | null>(null);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);

    const handleSync = async (connectionId?: string) => {
        setSyncMsg(null);
        try {
            const res = await sync.mutateAsync(connectionId);
            const total = res.results.reduce((n, r) => n + (r.upserted ?? 0), 0);
            const failed = res.results.filter((r) => !r.ok);
            setSyncMsg(
                failed.length
                    ? t('orders.channel.syncPartial', { n: total, err: failed[0]?.error ?? '' })
                    : t('orders.channel.syncOk', { n: total }),
            );
        } catch (e) {
            setSyncMsg(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <div className="space-y-5">
            <p className="text-[13px] leading-relaxed text-muted tracking-[0.14px]">{t('orders.channel.intro')}</p>

            <div className="flex flex-wrap items-center gap-2">
                {PLATFORMS.map((p) => (
                    <GhostButton key={p} onClick={() => setConnectPlatform(p)} className="px-4 py-2 text-[13px]">
                        <Link2 size={14} strokeWidth={1.75} />
                        {t(`orders.channel.connect.${p}`)}
                    </GhostButton>
                ))}
                {channels.length > 0 ? (
                    <SurfaceButton
                        onClick={() => void handleSync()}
                        disabled={sync.isPending}
                        icon={
                            <RefreshCw
                                size={13}
                                strokeWidth={2}
                                className={sync.isPending ? 'animate-spin' : undefined}
                            />
                        }
                    >
                        {t('orders.channel.syncAll')}
                    </SurfaceButton>
                ) : null}
            </div>

            {syncMsg ? (
                <p className="rounded-lg bg-surface px-3 py-2 text-[12px] text-secondary tracking-[0.14px] dark:bg-surface-elevated">
                    {syncMsg}
                </p>
            ) : null}

            {/* While memberships resolve the owner id is empty and the query is disabled —
                show the skeleton rather than a misleading "no channels" state. */}
            {isLoading || !isWorkspaceReady ? (
                <ChannelsListSkeleton />
            ) : channels.length === 0 ? (
                <EmptyState icon={<Store size={20} strokeWidth={1.5} />} message={t('orders.channel.empty')} />
            ) : (
                <div className="space-y-2.5">
                    {channels.map((c) => (
                        <ChannelCard
                            key={c.id}
                            channel={c}
                            busy={sync.isPending || disconnect.isPending || setAutoFulfill.isPending}
                            onSync={() => void handleSync(c.id)}
                            onToggleAutoFulfill={(enabled) => setAutoFulfill.mutate({ connectionId: c.id, enabled })}
                            onDisconnect={() => {
                                if (window.confirm(t('orders.channel.disconnectConfirm'))) {
                                    disconnect.mutate(c.id);
                                }
                            }}
                        />
                    ))}
                </div>
            )}

            <ConnectChannelModal
                open={!!connectPlatform}
                platform={connectPlatform}
                onClose={() => setConnectPlatform(null)}
            />
        </div>
    );
}

function ChannelCard({
    channel,
    busy,
    onSync,
    onDisconnect,
    onToggleAutoFulfill,
}: {
    channel: SalesChannelConnection;
    busy: boolean;
    onSync: () => void;
    onDisconnect: () => void;
    onToggleAutoFulfill: (enabled: boolean) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-main-bg px-4 py-3.5 transition-colors hover:border-black/10 dark:border-[#585d61] dark:hover:border-[#6c6a6b]">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[14px] font-medium text-primary tracking-[0.14px]">
                        {channel.display_name || channel.shop_identifier}
                    </p>
                    <Badge tone={channelStatusTone(channel.status)} size="sm">
                        {CHANNEL_STATUS_EN[channel.status] ?? channel.status}
                    </Badge>
                    <Badge tone="soft" size="sm">
                        {PLATFORM_EN[channel.platform] ?? channel.platform}
                    </Badge>
                </div>
                <p className="mt-1 text-[12px] text-muted tracking-[0.14px]">
                    {channel.shop_identifier}
                    {channel.last_polled_at
                        ? ` · ${t('orders.channel.lastSync', { at: formatDateShort(channel.last_polled_at) })}`
                        : ''}
                </p>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-secondary tracking-[0.14px]">
                    <input
                        type="checkbox"
                        className="rounded border-border-subtle"
                        checked={channel.auto_fulfill_on_shipped}
                        disabled={busy}
                        onChange={(e) => onToggleAutoFulfill(e.target.checked)}
                    />
                    {t('orders.channel.autoFulfill')}
                </label>
                {channel.last_error ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
                        {channel.last_error}
                    </p>
                ) : null}
            </div>
            <div className="flex shrink-0 gap-1.5">
                <GhostButton disabled={busy} onClick={onSync}>
                    <RefreshCw size={13} strokeWidth={1.75} />
                    {t('orders.channel.sync')}
                </GhostButton>
                <GhostButton
                    disabled={busy}
                    onClick={onDisconnect}
                    className="hover:text-red-500 hover:border-red-500/25"
                >
                    {t('orders.channel.disconnect')}
                </GhostButton>
            </div>
        </div>
    );
}
