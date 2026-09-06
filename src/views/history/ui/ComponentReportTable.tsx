import { aggregateComponentReport, type ComponentReportSession } from '@shared/lib/component-report';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const kg = (grams: number) => `${(grams / 1000).toFixed(2)} kg`;

export const ComponentReportTable = ({ sessions }: { sessions: ComponentReportSession[] }): ReactNode => {
    const { t } = useTranslation();
    const rows = useMemo(() => aggregateComponentReport(sessions), [sessions]);

    if (rows.length === 0) {
        return (
            <div className="rounded-lg bg-main-bg p-8 text-center text-sm text-muted dark:border dark:border-[#585d61]">
                {t('history.componentReport.empty')}
            </div>
        );
    }

    return (
        <div className="overflow-x-auto rounded-lg bg-main-bg dark:border dark:border-[#585d61]">
            <table className="w-full border-collapse text-left">
                <thead>
                    <tr className="border-b border-border-subtle dark:border-[#585d61]">
                        <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('history.componentReport.bean')}
                        </th>
                        <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('history.componentReport.sessions')}
                        </th>
                        <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('history.componentReport.green')}
                        </th>
                        <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('history.componentReport.output')}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.key} className="border-b border-border-subtle last:border-0 dark:border-[#585d61]">
                            <td className="px-4 py-3 text-[13px] font-medium text-primary">{row.beanName}</td>
                            <td className="px-4 py-3 text-right font-mono text-[13px] text-secondary">
                                {row.sessionCount}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-[13px] text-secondary">
                                {kg(row.greenGrams)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-[13px] text-secondary">
                                {kg(row.outputGrams)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
