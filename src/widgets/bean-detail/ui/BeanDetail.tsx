import { getStatus, processColor, statusConfig } from '@entities/bean/lib';
import { useBeanStockEvents, useBeanStockSummary } from '@entities/bean-stock-event';
import type { Bean } from '@shared/types/database.types';
import { Edit3, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DeleteBeanModal } from './DeleteBeanModal';

interface BeanDetailProps {
    bean: Bean | null;
    isLoading: boolean;
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

const Empty = ({ hasAny }: { hasAny: boolean }) => (
    <div className="bg-main-bg dark:border dark:border-[#585d61] rounded-lg px-8 py-15 flex items-center justify-center text-sm text-muted dark:text-white tracking-[0.14px]">
        {hasAny ? 'Select a bean to view details' : 'Add your first bean lot to get started.'}
    </div>
);

export const BeanDetail = ({ bean, isLoading, onEdit, onRestock, onStartRoast, onDelete }: BeanDetailProps) => {
    const [confirming, setConfirming] = useState(false);
    const { data: summary } = useBeanStockSummary(bean?.id ?? '');
    const { data: events = [] } = useBeanStockEvents(bean?.id ?? '');

    if (isLoading) return <Skeleton />;
    if (!bean) return <Empty hasAny={false} />;

    const status = getStatus(bean);
    const cfg = statusConfig[status];

    return (
        <>
            <DeleteBeanModal
                open={confirming}
                beanName={bean.name}
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
                        className="w-9 h-9 rounded-[10px] border border-black/6 bg-white text-muted flex items-center justify-center cursor-pointer transition-all duration-200"
                    >
                        <Edit3 size={16} />
                    </button>
                    <button
                        onClick={() => setConfirming(true)}
                        className="w-9 h-9 rounded-[10px] border border-black/6 bg-white flex items-center justify-center cursor-pointer transition-all duration-200"
                        style={{ color: '#dc2626' }}
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
                        { label: 'Origin', value: bean.origin ?? '—' },
                        { label: 'Region', value: bean.region ?? '—' },
                        { label: 'Farm', value: bean.farm ?? '—' },
                        {
                            label: 'Altitude',
                            value: bean.altitude_masl ? `${bean.altitude_masl.toLocaleString()} masl` : '—',
                        },
                        { label: 'Received', value: bean.purchase_date ?? '—' },
                        { label: 'Current Stock', value: `${(bean.stock_grams / 1000).toFixed(2)}kg` },
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
                            Tasting Notes
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
                        <span className="text-xs font-medium text-secondary tracking-[0.14px]">Stock Level</span>
                        <span className="text-xs text-muted font-mono">
                            {(bean.stock_grams / 1000).toFixed(2)}kg / {(bean.capacity_grams / 1000).toFixed(2)}kg
                        </span>
                    </div>
                    <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                                width: `${Math.min(100, (bean.stock_grams / bean.capacity_grams) * 100)}%`,
                                background: cfg.color,
                            }}
                        />
                    </div>
                </div>

                <div className="flex gap-2.5">
                    <button
                        onClick={onStartRoast}
                        className="flex-1 py-2.5 rounded-full border border-gray-200 dark:border-[#585d61] dark:bg-[#1a1e23] bg-primary text-white text-sm font-medium cursor-pointer tracking-[0.14px]"
                    >
                        Start Roast
                    </button>
                    <button
                        onClick={() => onRestock(bean.id)}
                        className="flex-1 py-2.5 rounded-full border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-white text-sm font-medium cursor-pointer tracking-[0.14px]"
                    >
                        Restock
                    </button>
                </div>

                <div className="mt-6 space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="bg-gray-50 dark:bg-surface-elevated rounded-lg p-2">
                            <p className="text-gray-400 dark:text-white">현재 재고</p>
                            <p className="font-semibold">{summary?.currentGrams ?? 0}g</p>
                        </div>
                        <div className="bg-yellow-50 dark:bg-[#1a1e23] rounded-lg p-2">
                            <p className="text-gray-400 dark:text-white">예약됨</p>
                            <p className="font-semibold text-yellow-700 dark:text-yellow-300">
                                {summary?.reservedGrams ?? 0}g
                            </p>
                        </div>
                        <div className="bg-green-50 dark:bg-[#1a1e23] rounded-lg p-2">
                            <p className="text-gray-400 dark:text-white">가용</p>
                            <p
                                className={`font-semibold ${(summary?.effectiveGrams ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}`}
                            >
                                {summary?.effectiveGrams ?? 0}g
                            </p>
                        </div>
                    </div>

                    <p className="text-xs font-medium text-gray-500 dark:text-white mt-4">재고 이력</p>
                    {events.length === 0 && <p className="text-xs text-gray-300 dark:text-white">이력 없음</p>}
                    {events.map((ev) => (
                        <div key={ev.id} className="flex items-start gap-3 text-xs">
                            <span
                                className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                                    ev.delta_grams > 0 ? 'bg-palette-green' : 'bg-palette-purple'
                                }`}
                            />
                            <div className="flex-1">
                                <span className="font-medium">
                                    {ev.delta_grams > 0 ? `+${ev.delta_grams}g` : `${ev.delta_grams}g`}
                                </span>
                                <span className="text-gray-400 dark:text-white ml-1">
                                    {ev.event_type === 'purchase'
                                        ? '입고'
                                        : ev.event_type === 'roast'
                                          ? '로스팅'
                                          : '조정'}
                                </span>
                                {ev.note && <span className="text-gray-400 dark:text-white ml-1">— {ev.note}</span>}
                            </div>
                            <span className="text-gray-300 dark:text-white">
                                {new Date(ev.created_at).toLocaleDateString('ko-KR')}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
};
