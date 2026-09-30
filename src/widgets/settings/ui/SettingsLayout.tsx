import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type SettingsNavigationProps, SettingsSidebar } from './SettingsSidebar';
import { getSearchTabs, getTabs } from './tabConfig';

export function SettingsLayout({
    activeTab,
    onTabChange,
    onClose,
    children,
}: SettingsNavigationProps & { children: ReactNode }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const contentRef = useRef<HTMLDivElement>(null);
    const emptyRef = useRef<HTMLParagraphElement>(null);
    const tab = getTabs(t).find((item) => item.id === activeTab);
    const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
        if (document.activeElement?.getAttribute('type') !== 'search') node?.focus({ preventScroll: true });
    }, []);
    const search = (value: string) => {
        setQuery(value);
        const matches = getSearchTabs(t, value);
        if (matches.length && !matches.some((item) => item.id === activeTab)) onTabChange(matches[0].id);
    };
    useLayoutEffect(() => {
        const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        const matchesTab = terms.every((term) => tab?.label.toLocaleLowerCase().includes(term));
        const sections = contentRef.current?.querySelectorAll<HTMLElement>('[data-settings-section]') ?? [];
        let visible = 0;
        for (const section of sections) {
            const text = section.textContent?.toLocaleLowerCase() ?? '';
            section.hidden = !matchesTab && !terms.every((term) => text.includes(term));
            if (!section.hidden) visible++;
        }
        if (emptyRef.current) emptyRef.current.hidden = !terms.length || visible > 0;
    }, [query, tab?.label]);
    return (
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-main-bg" data-testid="settings-page">
            <SettingsSidebar
                activeTab={activeTab}
                onTabChange={onTabChange}
                onClose={onClose}
                query={query}
                onQueryChange={search}
            />
            <main
                key={activeTab}
                aria-labelledby="settings-page-title"
                className="@container min-w-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8 lg:px-10 lg:py-10"
            >
                <div className="mx-auto w-full max-w-[760px]">
                    <header className="mb-6">
                        <h1
                            ref={focusHeading}
                            id="settings-page-title"
                            tabIndex={-1}
                            className="m-0 font-(--font-display) text-2xl font-semibold leading-tight tracking-[-0.4px] text-primary outline-none"
                        >
                            {tab?.label}
                        </h1>
                        <p className="m-0 mt-2 text-[13px] leading-relaxed text-secondary">{tab?.description}</p>
                    </header>
                    <div ref={contentRef}>{children}</div>
                    <p ref={emptyRef} hidden role="status" className="m-0 text-[13px] text-muted">
                        {t('settings.noSearchResults')}
                    </p>
                </div>
            </main>
        </div>
    );
}
