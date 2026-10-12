import {
    DEFAULT_SIDEBAR_PREFERENCES,
    SIDEBAR_GROUPS,
    updateSidebarPreferences,
    useSidebarPreferences,
} from '@shared/store/sidebar-preferences';
import type { View } from '@shared/types/view';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const SidebarPreferences = ({ collapsed }: { collapsed: boolean }) => {
    const { t } = useTranslation();
    const settings = useSidebarPreferences();
    const move = (ids: View[], index: number, delta: number) => {
        if (index + delta < 0 || index + delta >= ids.length) return;
        const swapped = [...ids];
        [swapped[index], swapped[index + delta]] = [swapped[index + delta], swapped[index]];
        const order = settings.order.map((id) => (ids.includes(id) ? (swapped.shift() as View) : id));
        updateSidebarPreferences({ order });
    };
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={t('sidebar.customize')}
                    title={t('sidebar.customize')}
                    className="mb-2 flex w-full items-center gap-2 rounded-lg p-2 text-xs text-muted hover:bg-surface"
                >
                    <SlidersHorizontal size={16} />
                    {!collapsed && t('sidebar.customize')}
                </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="end" className="max-h-[80vh] w-72 overflow-y-auto p-4">
                <h2 className="mb-3 text-sm font-medium text-primary">{t('sidebar.customize')}</h2>
                <label className="mb-4 flex items-center justify-between text-xs text-secondary">
                    {t('sidebar.fontSize')}
                    <select
                        value={settings.fontSize}
                        onChange={(event) => updateSidebarPreferences({ fontSize: Number(event.target.value) })}
                        className="rounded border border-border bg-main-bg p-1"
                    >
                        {[13, 15, 17].map((size) => (
                            <option key={size} value={size}>
                                {size}
                            </option>
                        ))}
                    </select>
                </label>
                {SIDEBAR_GROUPS.map((group) => {
                    const ids = settings.order.filter((id) => group.ids.includes(id));
                    return (
                        <section key={group.label} className="mb-3">
                            <h3 className="mb-2 text-xs text-muted">{t(group.label)}</h3>
                            {ids.map((id, index) => {
                                const label = t(`sidebar.nav.${id}`);
                                return (
                                    <div
                                        key={id}
                                        className="flex items-center justify-between py-1 text-xs text-primary"
                                    >
                                        <span>{label}</span>
                                        <div className="flex gap-1">
                                            <button
                                                type="button"
                                                disabled={index === 0}
                                                aria-label={t('sidebar.moveUp', { name: label })}
                                                onClick={() => move(ids, index, -1)}
                                                className="p-1 disabled:opacity-30"
                                            >
                                                <ArrowUp size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={index === ids.length - 1}
                                                aria-label={t('sidebar.moveDown', { name: label })}
                                                onClick={() => move(ids, index, 1)}
                                                className="p-1 disabled:opacity-30"
                                            >
                                                <ArrowDown size={14} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </section>
                    );
                })}
                <button
                    type="button"
                    onClick={() => updateSidebarPreferences(DEFAULT_SIDEBAR_PREFERENCES)}
                    className="text-xs text-secondary"
                >
                    {t('sidebar.reset')}
                </button>
            </PopoverContent>
        </Popover>
    );
};
