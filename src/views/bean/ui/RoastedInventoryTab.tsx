import { useBeans } from '@entities/bean/queries';
import { useBlends } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { useRoastedStock } from '@entities/roasted-stock-event';
import { PillButton } from '@shared/ui/PillButton';
import { useTranslation } from 'react-i18next';

interface RoastedInventoryTabProps {
    onOpenBlending?: () => void;
}

const fmtKg = (grams: number) => `${(grams / 1000).toFixed(2)}kg`;

export const RoastedInventoryTab = ({ onOpenBlending }: RoastedInventoryTabProps) => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: stock = {}, isLoading } = useRoastedStock(userId);
    const { data: beans = [] } = useBeans(userId);
    const { data: blends = [] } = useBlends(userId);

    const rows = Object.entries(stock)
        .map(([key, s]) => {
            const [kind, id] = key.split(':');
            const name =
                kind === 'bean'
                    ? (beans.find((b) => b.id === id)?.name ?? t('inventory.roasted.unknownBean'))
                    : (blends.find((b) => b.id === id)?.name ?? t('inventory.roasted.unknownBlend'));
            return { key, kind, name, grams: s.grams, hasEstimate: s.hasEstimate };
        })
        .sort((a, b) => b.grams - a.grams);

    if (isLoading) return <div className="py-10 text-center text-[13px] text-muted">…</div>;

    return (
        <div>
            <div className="mb-3 flex justify-end">
                {onOpenBlending && (
                    <PillButton onClick={onOpenBlending}>{t('inventory.roasted.blendAction')}</PillButton>
                )}
            </div>
            {rows.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-muted">{t('inventory.roasted.empty')}</div>
            ) : (
                <div className="grid gap-2">
                    {rows.map((r) => (
                        <div
                            key={r.key}
                            className="flex items-center justify-between rounded-lg border border-border-subtle px-4 py-3 dark:border-[#585d61]"
                        >
                            <div className="flex items-center gap-2">
                                <span className="text-[13px] font-medium text-primary">{r.name}</span>
                                {r.kind === 'blend' && (
                                    <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                                        {t('inventory.roasted.blendBadge')}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <span
                                    className={`font-mono text-[14px] font-medium ${r.grams < 0 ? 'text-red-500' : 'text-primary'}`}
                                >
                                    {fmtKg(r.grams)}
                                </span>
                                {r.hasEstimate && (
                                    <span className="text-[10px] font-semibold text-muted">
                                        {t('inventory.roasted.estimateBadge')}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
