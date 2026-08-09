import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface YearMonthRangeFieldsProps {
    fromYM: string;
    toYM: string;
    /** 선택 가능한 YYYY-MM 목록 — 연도 옵션을 여기서 뽑는다 */
    monthOptions: string[];
    onFromYM: (v: string) => void;
    onToYM: (v: string) => void;
}

/**
 * 시작/끝 두 줄의 연·월 Select 쌍. 감싸는 레이아웃은 호출부가 정한다
 * (필터 팝오버는 세로 패널, export 모달은 구분선 아래) — 여기서는 줄만 낸다.
 */
export const YearMonthRangeFields = ({ fromYM, toYM, monthOptions, onFromYM, onToYM }: YearMonthRangeFieldsProps) => {
    const { t } = useTranslation();
    const months = t('months', { returnObjects: true }) as string[];

    const years = useMemo(
        () => [...new Set(monthOptions.map((ym) => ym.split('-')[0]))].sort((a, b) => Number(b) - Number(a)),
        [monthOptions],
    );

    const rows = [
        { label: t('history.customRange.start'), val: fromYM, set: onFromYM },
        { label: t('history.customRange.end'), val: toYM, set: onToYM },
    ];

    return (
        <>
            {rows.map(({ label, val, set }) => {
                const yr = val ? val.split('-')[0] : '';
                const mo = val ? val.split('-')[1] : '';
                return (
                    <div key={label} className="flex items-center gap-2">
                        <span className="w-7 shrink-0 text-[11px] font-medium tracking-[0.5px] text-muted uppercase">
                            {label}
                        </span>
                        <Select value={yr} onValueChange={(v) => set(mo ? `${v}-${mo}` : v)}>
                            <SelectTrigger className="w-24 border border-border-subtle dark:border-[#585d61]">
                                <SelectValue placeholder={t('history.customRange.year')} />
                            </SelectTrigger>
                            <SelectContent>
                                {years.map((y) => (
                                    <SelectItem key={y} value={y}>
                                        {y}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={mo} onValueChange={(v) => set(yr ? `${yr}-${v}` : v)}>
                            <SelectTrigger className="w-20 border border-border-subtle dark:border-[#585d61]">
                                <SelectValue placeholder={t('history.customRange.month')} />
                            </SelectTrigger>
                            <SelectContent>
                                {months.map((name, i) => (
                                    <SelectItem key={name} value={String(i + 1).padStart(2, '0')}>
                                        {name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                );
            })}
        </>
    );
};
