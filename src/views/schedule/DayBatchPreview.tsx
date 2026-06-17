import type { DayPlanBatchItem } from '@entities/plan';
import { useTranslation } from 'react-i18next';

export const DayBatchPreview = ({
    batches,
    maxLines = 3,
    compact = false,
}: {
    batches: DayPlanBatchItem[];
    maxLines?: number;
    compact?: boolean;
}) => {
    const { t } = useTranslation();
    if (batches.length === 0) return null;

    const visible = batches.slice(0, maxLines);
    const overflow = batches.length - maxLines;

    return (
        <div className="flex flex-col gap-0.5 w-full overflow-hidden">
            {visible.map((b) => (
                <div
                    key={b.id}
                    className={`truncate ${compact ? 'text-[9px]' : 'text-[10px]'} px-0.5 leading-tight`}
                    title={`${b.bean_name} · ${b.target_roasted_kg} kg`}
                >
                    <span className="text-foreground/80">{b.bean_name}</span>
                    <span className="text-muted"> · {b.target_roasted_kg} kg</span>
                </div>
            ))}
            {overflow > 0 && (
                <div className="text-[10px] text-muted px-0.5">
                    {compact ? `+${overflow}` : t('schedule.overflowMore', { count: overflow })}
                </div>
            )}
        </div>
    );
};
