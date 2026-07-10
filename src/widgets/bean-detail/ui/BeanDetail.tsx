import { processColor } from '@entities/bean/lib';
import { useBeanStockEvents, useBeanStockSummary } from '@entities/bean-stock-event';
import type { Bean } from '@shared/types/database.types';
import { Edit3, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DeleteBeanModal } from './DeleteBeanModal';

const EVENT_TYPE_LABEL_KEY: Record<string, string> = {
    purchase: 'beanDetail.stockHistory.purchase',
    expected_inbound: 'beanDetail.stockHistory.expectedInbound',
    roast: 'beanDetail.stockHistory.roast',
    write_off: 'beanDetail.stockHistory.writeOff',
};

interface BeanDetailProps {
    bean: Bean | null;
    isLoading: boolean;
    affectedBlendNames: string[];
    onEdit: (bean: Bean) => void;
    onRestock: (id: string) => void;
    onStartRoast: () => void;
    onDelete: (id: string) => void;
}

const Skeleton = () => (
    <div className="bg-main-bg dark:border dark:border-[#585d61] rounded-lg px-8 py-7">
        <div className="mb-6">
            <div className="w-50 h-8 rounded-lg bg-surface mb-2.5 animate-pulse" />
            <div className="flex gap-1.5">
                <div className="w-15 h-5.5 rounded-full bg-surface animate-pulse" />
                <div className="w-20 h-5.5 rounded-full bg-surface animate-pulse" />
            </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-6">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                    <div className="w-12.5 h-2.5 rounded bg-surface mb-1.5 animate-pulse" />
                    <div className="w-25 h-3.5 rounded-md bg-surface animate-pulse" />
                </div>
            ))}
        </div>
        <div className="h-1.5 rounded-full bg-surface mb-6 animate-pulse" />
        <div className="flex gap-2.5">
            <div className="flex-1 h-10 rounded-full bg-surface animate-pulse" />
            <div className="flex-1 h-10 rounded-full bg-surface animate-pulse" />
        </div>
    </div>
);

const Empty = ({ hasAny }: { hasAny: boolean }) => {
    const { t } = useTranslation();
    return (
        <div className="bg-main-bg dark:border dark:border-[#585d61] rounded-lg px-8 py-15 flex items-center justify-center text-sm text-muted dark:text-[#e5e5e5] tracking-[0.14px]">
            {hasAny ? t('beanDetail.empty.select') : t('beanDetail.empty.addFirst')}
        </div>
    );
};

export const BeanDetail = ({
    bean,
    isLoading,
    affectedBlendNames,
    onEdit,
    onRestock,
    onStartRoast,
    onDelete,
}: BeanDetailProps) => {
    const { t } = useTranslation();
    const [confirming, setConfirming] = useState(false);
    const { data: summary } = useBeanStockSummary(bean?.id ?? '');
    const { data: events = [] } = useBeanStockEvents(bean?.id ?? '');

    if (isLoading) return <Skeleton />;
    if (!bean) return <Empty hasAny={false} />;

    const currentGrams = summary?.currentGrams ?? 0;
    const availableGrams = summary?.availableGrams ?? 0;
    const effectiveGrams = summary?.effectiveGrams ?? 0;

    return (
        <>
            <DeleteBeanModal
                open={confirming}
                beanName={bean.name}
                affectedBlendNames={affectedBlendNames}
                onClose={() => setConfirming(false)}
                onConfirm={() => {
                    onDelete(bean.id);
                    setConfirming(false);
                }}
            />
            <div className="bg-main-bg rounded-lg px-8 py-7 h-fit relative dark:border dark:border-[#585d61]">
                <div className="absolute top-6 right-6 flex gap-2 z-2">
                    <button
                        onClick={() => onEdit(bean)}
                        className="w-9 h-9 rounded-[10px] border border-black/6 dark:border-[#585d61] bg-white dark:bg-[#262b31] text-muted dark:text-[#e5e5e5] flex items-center justify-center cursor-pointer transition-all duration-200"
                    >
                        <Edit3 size={16} />
                    </button>
                    <button
                        onClick={() => setConfirming(true)}
                        className="w-9 h-9 rounded-[10px] border border-black/6 dark:border-[#585d61] bg-white dark:bg-[#262b31] flex items-center justify-center cursor-pointer transition-all duration-200 text-red-600 dark:text-red-400"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>

                <div className="mb-6 pr-10">
                    <h2 className="font-(--font-display) text-[26px] leading-[1.2] text-primary tracking-[-0.3px] mb-1">
                        {bean.name}
                    </h2>
                    <div className="flex gap-1.5">
                        {bean.process && (
                            <span
                                className="text-xs font-medium px-2.25 py-0.75 rounded-full tracking-[0.14px]"
                                style={{
                                    color: processColor[bean.process]?.color ?? 'var(--color-secondary)',
                                    background: processColor[bean.process]?.bg ?? 'var(--color-surface)',
                                }}
                            >
                                {bean.process}
                            </span>
                        )}
                        {bean.variety && (
                            <span className="text-xs font-medium text-secondary bg-surface px-2.25 py-0.75 rounded-full">
                                {bean.variety}
                            </span>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                    {[
                        { label: t('beanDetail.origin'), value: bean.origin ?? '—' },
                        { label: t('beanDetail.region'), value: bean.region ?? '—' },
                        { label: t('beanDetail.farm'), value: bean.farm ?? '—' },
                        {
                            label: t('beanDetail.altitude'),
                            value: bean.altitude_masl ? `${bean.altitude_masl.toLocaleString()} masl` : '—',
                        },
                        { label: t('beanDetail.received'), value: bean.purchase_date ?? '—' },
                        { label: t('beanDetail.currentStock'), value: `${(currentGrams / 1000).toFixed(2)}kg` },
                        {
                            label: t('beanDetail.available'),
                            value: `${(availableGrams / 1000).toFixed(2)}kg`,
                        },
                        {
                            label: t('beanDetail.effective'),
                            value: `${(effectiveGrams / 1000).toFixed(2)}kg`,
                        },
                    ].map(({ label, value }) => (
                        <div key={label}>
                            <div className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase mb-0.75">
                                {label}
                            </div>
                            <div className="text-sm font-medium text-primary tracking-[0.14px]">{value}</div>
                        </div>
                    ))}
                </div>

                {bean.tasting_notes && (
                    <div className="bg-surface-warm-solid rounded-lg px-4 py-3.5 mb-6">
                        <div className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase mb-2">
                            {t('beanDetail.tastingNotes')}
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                            {bean.tasting_notes.split(', ').map((note) => (
                                <span
                                    key={note}
                                    className="text-xs font-medium text-secondary bg-white/70 px-2.5 py-1 rounded-full tracking-[0.14px]"
                                >
                                    {note}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                <div className="mb-6">
                    <div className="flex justify-between mb-1.5">
                        <span className="text-xs font-medium text-secondary tracking-[0.14px]">
                            {t('beanDetail.stockLevel')}
                        </span>
                        <span className="text-xs text-muted font-mono">
                            {(currentGrams / 1000).toFixed(2)}kg / {(bean.capacity_grams / 1000).toFixed(2)}kg
                        </span>
                    </div>
                    <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full bg-palette-green transition-all duration-500"
                            style={{
                                width: `${Math.min(100, (currentGrams / bean.capacity_grams) * 100)}%`,
                            }}
                        />
                    </div>
                </div>

                <div className="flex gap-2.5">
                    <button
                        onClick={() => onRestock(bean.id)}
                        className="flex-1 py-2.5 rounded-full border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-[#e5e5e5] text-sm font-medium cursor-pointer tracking-[0.14px]"
                    >
                        {t('beanDetail.restock')}
                    </button>
                    <button
                        onClick={onStartRoast}
                        className="flex-1 py-2.5 rounded-full border border-gray-200 dark:border-0 dark:bg-[#0d0d0d] bg-primary text-white text-sm font-medium cursor-pointer tracking-[0.14px]"
                    >
                        {t('beanDetail.startRoast')}
                    </button>
                </div>

                <div className="mt-6 space-y-3">
                    <p className="text-xs font-medium text-gray-500 dark:text-[#e5e5e5]">
                        {t('beanDetail.stockHistory.title')}
                    </p>
                    {events.length === 0 && (
                        <p className="text-xs text-gray-300 dark:text-[#e5e5e5]">
                            {t('beanDetail.stockHistory.empty')}
                        </p>
                    )}
                    {events.length > 0 && (
                        <div
                            className={events.length > 3 ? 'max-h-[76px] overflow-y-auto space-y-3 pr-1' : 'space-y-3'}
                        >
                            {events.map((ev) => (
                                <div key={ev.id} className="flex items-start gap-3 text-xs">
                                    <span
                                        className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                                            ev.delta_grams > 0 ? 'bg-palette-green' : 'bg-palette-purple'
                                        }`}
                                    />
                                    <div className="flex-1">
                                        <span className="font-medium">
                                            {ev.delta_grams > 0 ? `+${ev.delta_grams}g` : `${ev.delta_grams}g`}
                                        </span>
                                        <span className="text-gray-400 dark:text-[#e5e5e5] ml-1">
                                            {t(
                                                EVENT_TYPE_LABEL_KEY[ev.event_type] ??
                                                    'beanDetail.stockHistory.adjustment',
                                            )}
                                        </span>
                                        {ev.note && (
                                            <span className="text-gray-400 dark:text-[#e5e5e5] ml-1">— {ev.note}</span>
                                        )}
                                    </div>
                                    <span className="text-gray-300 dark:text-[#e5e5e5] whitespace-nowrap">
                                        {new Date(ev.created_at).toLocaleDateString('ko-KR')}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};
