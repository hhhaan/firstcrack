import { useCreateEventInvite, useEventInvite, useRevokeCuppingInvite } from '@entities/cupping';
import { Badge } from '@shared/ui/Badge';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Check, Copy, Link2, QrCode } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type CuppingSessionInviteProps = {
    eventId: string;
    userId: string;
    title: string;
    sampleCount: number;
    /** When true, invite query forced null — matches list badge after session end. */
    isEnded?: boolean;
};

export const CuppingSessionInvite = ({
    eventId,
    userId,
    title,
    sampleCount,
    isEnded = false,
}: CuppingSessionInviteProps) => {
    const { t } = useTranslation();
    const { data: activeInvite } = useEventInvite(eventId, true, isEnded);
    const createInvite = useCreateEventInvite(userId, eventId);
    const revokeInvite = useRevokeCuppingInvite(eventId, userId);

    const [showQr, setShowQr] = useState(false);
    const [qrUrl, setQrUrl] = useState<string | null>(null);
    const [qrInviteId, setQrInviteId] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) return;
        const id = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(id);
    }, [copied]);

    const handleQr = async () => {
        if (activeInvite) {
            setQrUrl(activeInvite.url);
            setQrInviteId(activeInvite.id);
            setShowQr(true);
            return;
        }
        const inv = await createInvite.mutateAsync({});
        setQrUrl(inv.url);
        setQrInviteId(inv.id);
        setShowQr(true);
    };

    const closeQr = () => {
        setShowQr(false);
        setQrUrl(null);
        setQrInviteId(null);
    };

    const qrSrc = qrUrl
        ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrUrl)}`
        : null;

    return (
        <>
            {/* Session = container; samples inside; one QR for the whole session */}
            <div className="mb-5 rounded-xl border border-border-subtle bg-main-bg p-4 dark:border-border">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                            <p className="text-[13px] font-semibold text-primary tracking-[0.14px]">
                                {t('cupping.sessionPanelTitle')}
                            </p>
                            <Badge
                                tone={activeInvite || sampleCount > 0 ? (activeInvite ? 'good' : 'muted') : 'muted'}
                                size="sm"
                            >
                                {activeInvite ? t('cupping.sessionLinkActive') : t('cupping.sessionLinkNone')}
                            </Badge>
                        </div>
                        <p className="text-[12px] leading-relaxed text-muted tracking-[0.14px]">
                            {t('cupping.sessionPanelBody')}
                        </p>
                        {sampleCount === 0 ? (
                            <p className="mt-2 text-[12px] text-secondary tracking-[0.14px]">
                                {t('cupping.sessionQrNeedSamples')}
                            </p>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        onClick={() => void handleQr()}
                        disabled={createInvite.isPending || sampleCount === 0}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-transparent px-4 py-2 text-[12px] font-medium text-primary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 dark:border-border dark:hover:bg-surface-elevated cursor-pointer"
                    >
                        <QrCode size={14} strokeWidth={1.75} />
                        {t('cupping.sessionQr')}
                    </button>
                </div>
            </div>

            {showQr && qrUrl ? (
                <ModalShell onClose={closeQr} labelledBy="cupping-qr-title">
                    <div className="w-full max-w-sm rounded-xl bg-main-bg p-6 shadow-lg dark:border dark:border-border">
                        <h2 id="cupping-qr-title" className="mb-1 text-base font-semibold text-primary">
                            {title}
                        </h2>
                        <p className="mb-4 text-[12px] text-muted">{t('cupping.sessionQrHint')}</p>
                        {qrSrc ? (
                            <img
                                src={qrSrc}
                                alt="QR"
                                width={180}
                                height={180}
                                className="mx-auto mb-4 rounded-md bg-white p-2"
                            />
                        ) : null}
                        <div className="mb-3 break-all font-mono text-[11px] text-secondary">{qrUrl}</div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={async () => {
                                    await navigator.clipboard.writeText(qrUrl);
                                    setCopied(true);
                                }}
                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-3 py-1.5 text-xs dark:border-border"
                            >
                                {copied ? <Check size={14} /> : <Copy size={14} />}
                                {copied ? t('cupping.copied') : t('cupping.copyLink')}
                            </button>
                            <a
                                href={qrUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-3 py-1.5 text-xs dark:border-border"
                            >
                                <Link2 size={14} />
                                {t('cupping.openLink')}
                            </a>
                            {qrInviteId ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void revokeInvite.mutateAsync(qrInviteId).then(closeQr);
                                    }}
                                    className="rounded-full border border-border-subtle px-3 py-1.5 text-xs text-muted dark:border-border"
                                >
                                    {t('cupping.revoke')}
                                </button>
                            ) : null}
                        </div>
                    </div>
                </ModalShell>
            ) : null}
        </>
    );
};
