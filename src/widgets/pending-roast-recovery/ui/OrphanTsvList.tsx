import type { PairedLocalTsv } from '@shared/lib/tsv-writer';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { PillButton } from '@shared/ui/PillButton';
import { useTranslation } from 'react-i18next';

export const OrphanTsvList = ({ items, onDismiss }: { items: PairedLocalTsv[]; onDismiss: () => void }) => {
    const { t } = useTranslation();

    return (
        <ModalShell
            onClose={onDismiss}
            labelledBy="orphan-tsv-title"
            overlayClassName="z-[10000]"
            contentClassName={modalPanel.sm}
        >
            <h2 id="orphan-tsv-title" className="text-[18px] font-semibold text-primary tracking-[-0.3px] m-0">
                {t('activeRoast.recovery.orphanTitle')}
            </h2>
            <p className="text-[13px] text-secondary leading-relaxed mt-2 mb-4">
                {t('activeRoast.recovery.orphanMsg')}
            </p>
            <ul className="m-0 mb-5 p-0 list-none max-h-[240px] overflow-y-auto space-y-1.5">
                {items.map((item) => (
                    <li
                        key={item.sessionId}
                        className="flex items-center justify-between gap-2 rounded-lg bg-surface dark:bg-surface-elevated px-3 py-2"
                    >
                        <span className="font-mono text-[12px] text-primary truncate">{item.sessionId}</span>
                        {item.hasBbpTsv ? (
                            <span className="text-[11px] text-muted shrink-0">
                                {t('activeRoast.recovery.orphanBbp')}
                            </span>
                        ) : null}
                    </li>
                ))}
            </ul>
            <div className="flex justify-end">
                <PillButton type="button" onClick={onDismiss}>
                    {t('activeRoast.recovery.orphanOk')}
                </PillButton>
            </div>
        </ModalShell>
    );
};
