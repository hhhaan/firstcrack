import type { View } from '@shared/types/view';
import { Calendar, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UpcomingBatch } from '../api/useDashboard';

interface UpcomingBatchesProps {
    data: UpcomingBatch[];
    loading: boolean;
    onNavigate: (view: View) => void;
}

export const UpcomingBatches = ({ data, loading, onNavigate }: UpcomingBatchesProps) => {
    const { t } = useTranslation();

    return (
        <div className="bg-main-bg rounded-lg px-6 py-5 dark:border dark:border-[#585d61]">
            <div className="flex items-center justify-between mb-3.5">
                <h2 className="text-[15px] font-medium text-primary tracking-[0.15px]">
                    {t('dashboard.upcomingBatches')}
                </h2>
                <button
                    onClick={() => onNavigate('schedule')}
                    className="flex items-center justify-center border-none bg-transparent text-muted cursor-pointer hover:text-primary transition-colors p-0"
                >
                    <ChevronRight size={13} strokeWidth={2} />
                </button>
            </div>
            {loading ? (
                <p className="text-[13px] text-muted py-2">{t('dashboard.loading')}</p>
            ) : data.length === 0 ? (
                <p className="text-[13px] text-muted py-2">{t('dashboard.noUpcoming')}</p>
            ) : (
                data.map((item, i) => (
                    <div
                        key={item.id}
                        className={`flex items-center gap-3 py-2.5 ${i < data.length - 1 ? 'border-b border-divider' : ''}`}
                    >
                        <div className="w-8.5 h-8.5 rounded-lg bg-surface-warm-solid flex items-center justify-center shrink-0">
                            <Calendar size={14} strokeWidth={1.5} className="text-secondary" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-medium text-primary tracking-[0.14px] truncate">
                                    {item.bean_name}
                                </span>
                                <span className="shrink-0 text-[11px] font-medium text-secondary bg-surface px-1.5 py-0.5 rounded">
                                    {t('dashboard.batchCount', { count: item.batch_count })} · {item.target_roasted_kg}
                                    kg
                                </span>
                            </div>
                            <div className="text-xs text-muted tracking-[0.14px]">
                                {item.date === new Date().toISOString().slice(0, 10) ? t('dashboard.today') : item.date}{' '}
                                · {item.status}
                                {item.stockShort && (
                                    <span className="ml-1.5 text-amber-600 font-medium">
                                        · {t('dashboard.upcomingStockShort')}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
    );
};
