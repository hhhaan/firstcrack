import { useActiveWorkspace } from '@entities/organization';
import {
    type Product,
    useDeleteProductChannelSku,
    useProductChannelSkus,
    useUpsertProductChannelSku,
} from '@entities/product';
import { useChannelListings, useSalesChannels } from '@entities/sales-channel';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { Badge } from '@shared/ui/Badge';
import { FormSelect } from '@shared/ui/FormSelect';
import { inputCls, labelCls, modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalFooter } from '@shared/ui/modal-shell/ModalFooter';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
    product: Product | null;
    onClose: () => void;
};

/**
 * Bind a local product to the ids a sales channel uses for it (#164 / #131).
 * The body (and its queries) only mounts while open — ProductsTable keeps this element around
 * permanently, and the mapping table must not be read on every Products visit.
 */
export const MapChannelProductModal = ({ product, onClose }: Props) =>
    product ? <MapChannelProductBody product={product} onClose={onClose} /> : null;

/**
 * One product may hold one key per channel listing; the catalog picker is offered when the
 * platform can list products, otherwise the key is typed in (Naver, or a failed catalog call).
 */
function MapChannelProductBody({ product, onClose }: { product: Product; onClose: () => void }) {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: connections = [] } = useSalesChannels(userId);
    const { data: mappings = [] } = useProductChannelSkus(userId);
    const upsert = useUpsertProductChannelSku(userId);
    const remove = useDeleteProductChannelSku(userId);

    const [connectionId, setConnectionId] = useState('');
    const [manualKey, setManualKey] = useState('');
    const [pickedKey, setPickedKey] = useState('');
    const [error, setError] = useState<string | null>(null);

    useFormEscape(true, onClose);

    // biome-ignore lint/correctness/useExhaustiveDependencies: default to the first connection once they load
    useEffect(() => {
        setConnectionId((cur) => cur || (connections[0]?.id ?? ''));
    }, [connections.length]);

    const connection = connections.find((c) => c.id === connectionId) ?? null;
    const listings = useChannelListings(connection?.id ?? null);
    const hasCatalog = (listings.data?.length ?? 0) > 0;

    const own = mappings.filter((m) => m.product_id === product.id);
    const key = (hasCatalog ? pickedKey : manualKey).trim();

    const submit = async () => {
        if (!connection || !key) return;
        setError(null);
        try {
            await upsert.mutateAsync({
                user_id: userId,
                product_id: product.id,
                platform: connection.platform,
                external_key: key,
            });
            setManualKey('');
            setPickedKey('');
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <ModalShell onClose={onClose} labelledBy="map-channel-product-title" contentClassName={modalPanel.formSm}>
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="map-channel-product-title"
                    title={t('orders.mapping.title')}
                    subtitle={<p className="mt-1 text-[13px] tracking-[0.14px] text-muted">{product.name}</p>}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <ModalScrollBody contentClassName="p-8 space-y-5">
                <div>
                    <p className={labelCls}>{t('orders.mapping.existing')}</p>
                    {own.length === 0 ? (
                        <p className="text-[12px] text-muted">{t('orders.mapping.none')}</p>
                    ) : (
                        <ul className="space-y-1.5">
                            {own.map((m) => (
                                <li key={m.id} className="flex items-center gap-2 font-mono text-[12px] text-secondary">
                                    <Badge tone="soft" size="sm">
                                        {t(`orders.channel.platform.${m.platform}`, { defaultValue: m.platform })}
                                    </Badge>
                                    <span className="truncate">{m.external_key}</span>
                                    <button
                                        type="button"
                                        onClick={() => remove.mutate(m.id)}
                                        aria-label={t('orders.mapping.remove')}
                                        className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-red-500/10 hover:text-red-500"
                                    >
                                        <X size={12} strokeWidth={2} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {connections.length === 0 ? (
                    <p className="text-[12px] text-muted">{t('orders.mapping.noConnections')}</p>
                ) : (
                    <>
                        <div>
                            <label className={labelCls} htmlFor="map-connection">
                                {t('orders.mapping.connection')}
                            </label>
                            <FormSelect
                                id="map-connection"
                                value={connectionId}
                                onChange={(e) => {
                                    setConnectionId(e.target.value);
                                    setPickedKey('');
                                }}
                            >
                                {connections.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {t(`orders.channel.platform.${c.platform}`, { defaultValue: c.platform })} ·{' '}
                                        {c.display_name ?? c.shop_identifier}
                                    </option>
                                ))}
                            </FormSelect>
                        </div>

                        {listings.isLoading ? (
                            <p className="text-[12px] text-muted">{t('orders.mapping.listingLoading')}</p>
                        ) : hasCatalog ? (
                            <div>
                                <label className={labelCls} htmlFor="map-listing">
                                    {t('orders.mapping.listing')}
                                </label>
                                <FormSelect
                                    id="map-listing"
                                    value={pickedKey}
                                    onChange={(e) => setPickedKey(e.target.value)}
                                >
                                    <option value="">{t('orders.mapping.listingPick')}</option>
                                    {listings.data?.map((l) => {
                                        const k = l.platformVariantId ?? l.platformProductId;
                                        return (
                                            <option key={k} value={k}>
                                                {l.title}
                                                {l.sku ? ` (${l.sku})` : ''}
                                            </option>
                                        );
                                    })}
                                </FormSelect>
                            </div>
                        ) : (
                            <div>
                                <label className={labelCls} htmlFor="map-key">
                                    {t('orders.mapping.manualKey')}
                                </label>
                                <input
                                    id="map-key"
                                    className={inputCls}
                                    value={manualKey}
                                    onChange={(e) => setManualKey(e.target.value)}
                                    placeholder={t('orders.mapping.manualKeyPh')}
                                    autoComplete="off"
                                />
                                <p className="mt-1 text-[11px] text-muted">
                                    {listings.isError
                                        ? t('orders.mapping.listingError')
                                        : t('orders.mapping.manualHelp')}
                                </p>
                            </div>
                        )}
                    </>
                )}

                {error ? (
                    <p className="rounded-lg bg-[rgba(192,57,43,0.07)] px-3 py-2 text-[12px] leading-relaxed tracking-[0.14px] text-[#c0392b]">
                        {error}
                    </p>
                ) : null}
            </ModalScrollBody>

            <ModalFooter
                onCancel={onClose}
                cancelLabel={t('common.close')}
                onPrimary={() => void submit()}
                primaryDisabled={upsert.isPending || !connection || !key}
                primaryLabel={upsert.isPending ? t('orders.mapping.saving') : t('orders.mapping.save')}
            />
        </ModalShell>
    );
}
