import { getDateFnsLocale, i18n } from '@shared/i18n';
import { addDays, addMonths, addWeeks, endOfWeek, format, isToday, startOfWeek } from 'date-fns';
import { useCallback, useState } from 'react';
import type { ViewMode } from '../lib';

export const useScheduleNav = () => {
    const [view, setView] = useState<ViewMode>('day');
    const [selectedDate, setSelectedDate] = useState(new Date());

    const handleSelectDay = useCallback((d: Date) => {
        setSelectedDate(d);
        setView('day');
    }, []);

    const handleNav = useCallback(
        (dir: 1 | -1) => {
            setSelectedDate((prev) => {
                if (view === 'day') return addDays(prev, dir);
                if (view === 'week') return addWeeks(prev, dir);
                return addMonths(prev, dir);
            });
        },
        [view],
    );

    const navLabel = (() => {
        if (view === 'day') return format(selectedDate, i18n.t('schedule.dateFormat'), { locale: getDateFnsLocale() });
        if (view === 'week') {
            const ws = startOfWeek(selectedDate, { weekStartsOn: 1 });
            const we = endOfWeek(selectedDate, { weekStartsOn: 1 });
            const fmt = i18n.t('schedule.weekDateFormat');
            return `${format(ws, fmt)} – ${format(we, fmt)}`;
        }
        return format(selectedDate, i18n.t('schedule.monthFormat'), { locale: getDateFnsLocale() });
    })();

    const isTodaySelected = isToday(selectedDate);

    const goToday = useCallback(() => {
        setSelectedDate(new Date());
    }, []);

    return { view, setView, selectedDate, handleSelectDay, handleNav, navLabel, isTodaySelected, goToday };
};
