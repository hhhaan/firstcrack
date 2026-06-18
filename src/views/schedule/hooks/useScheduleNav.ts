import { useState, useCallback } from 'react';
import { addDays, addWeeks, addMonths, startOfWeek, endOfWeek, format } from 'date-fns';
import { getDateFnsLocale } from '@shared/i18n';
import { isToday } from 'date-fns';
import type { ViewMode } from '../lib';
import { toFullDisplayDate } from '../lib';

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
        if (view === 'day') return toFullDisplayDate(selectedDate);
        if (view === 'week') {
            const ws = startOfWeek(selectedDate, { weekStartsOn: 1 });
            const we = endOfWeek(selectedDate, { weekStartsOn: 1 });
            return `${format(ws, 'M/d')} – ${format(we, 'M/d')}`;
        }
        return format(selectedDate, 'yyyy년 M월', { locale: getDateFnsLocale() });
    })();

    const isTodaySelected = isToday(selectedDate);

    const goToday = useCallback(() => {
        setSelectedDate(new Date());
    }, []);

    return { view, setView, selectedDate, handleSelectDay, handleNav, navLabel, isTodaySelected, goToday };
};
