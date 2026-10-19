import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type SettingsNavigationProps, SettingsSidebar } from './SettingsSidebar';
import { getSearchTabs, getTabs, type RoastSettingsGroup, roastSettingsGroups } from './tabConfig';

export function SettingsLayout({
    activeTab,
    onTabChange,
    onClose,
    initialRoastGroup = null,
    children,
}: SettingsNavigationProps & { initialRoastGroup?: RoastSettingsGroup | null; children: ReactNode }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [roastGroup, setRoastGroup] = useState<RoastSettingsGroup>(initialRoastGroup ?? 'general');
    const contentRef = useRef<HTMLDivElement>(null);
    const emptyRef = useRef<HTMLParagraphElement>(null);
    const tab = getTabs(t).find((item) => item.id === activeTab);
    const groupLabel = activeTab === 'roast' && !query.trim() ? t(`settings.tabs.roast.groups.${roastGroup}`) : null;
    const changeTab = (nextTab: SettingsNavigationProps['activeTab']) => {
        setQuery('');
        setRoastGroup('general');
        onTabChange(nextTab);
    };
    const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
        if (document.activeElement?.getAttribute('type') !== 'search') node?.focus({ preventScroll: true });
    }, []);
    const search = (value: string) => {
        setQuery(value);
        setRoastGroup('general');
        const matches = getSearchTabs(t, value);
        if (matches.length && !matches.some((item) => item.id === activeTab)) onTabChange(matches[0].id);
    };
    useLayoutEffect(() => {
        const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        const matchesTab = terms.every((term) => tab?.label.toLocaleLowerCase().includes(term));
        const sections = contentRef.current?.querySelectorAll<HTMLElement>('[data-settings-section]') ?? [];
        let visible = 0;
        for (const section of sections) {
            const group = section.dataset.settingsGroup;
            const groupText =
                activeTab === 'roast' && roastSettingsGroups.some((id) => id === group)
                    ? t(`settings.tabs.roast.groups.${group}`)
                    : '';
            const text = `${groupText} ${section.textContent}`.toLocaleLowerCase();
            section.hidden =
                (activeTab === 'roast' && (!terms.length || matchesTab) && group !== roastGroup) ||
                (!matchesTab && !terms.every((term) => text.includes(term)));
            if (!section.hidden) visible++;
        }
        if (emptyRef.current) emptyRef.current.hidden = !terms.length || visible > 0;
    }, [query, tab?.label, activeTab, roastGroup, t]);
    return (
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-shell-bg" data-testid="settings-page">
            <SettingsSidebar
                activeTab={activeTab}
                onTabChange={changeTab}
                activeRoastGroup={roastGroup}
                onRoastGroupChange={setRoastGroup}
                onClose={onClose}
                query={query}
                onQueryChange={search}
            />
            <div className="flex min-h-0 min-w-0 flex-1 bg-transparent">
                <main
                    key={`${activeTab}:${roastGroup}`}
                    aria-labelledby="settings-page-title"
                    className="@container mt-2 mr-2 mb-2 min-h-0 min-w-0 flex-1 overflow-y-auto rounded-2xl border border-border-subtle bg-main-bg px-6 py-8 shadow-xs sm:px-8"
                >
                    <div className="mx-auto w-full max-w-[760px]">
                        <header className="mb-6">
                            {groupLabel && <p className="m-0 mb-2 text-xs text-muted">{tab?.label}</p>}
                            <h1
                                ref={focusHeading}
                                id="settings-page-title"
                                tabIndex={-1}
                                className="m-0 font-(--font-display) text-2xl font-medium leading-8 tracking-[0.24px] text-primary outline-none"
                            >
                                {groupLabel ?? tab?.label}
                            </h1>
                            {!groupLabel && (
                                <p className="m-0 mt-2 text-sm font-[450] leading-5 text-muted">{tab?.description}</p>
                            )}
                        </header>
                        <div ref={contentRef}>{children}</div>
                        <p ref={emptyRef} hidden role="status" className="m-0 text-[13px] text-muted">
                            {t('settings.noSearchResults')}
                        </p>
                    </div>
                </main>
            </div>
        </div>
    );
}
