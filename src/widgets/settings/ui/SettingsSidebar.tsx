import { cn } from '@shared/lib/cn';
import { ArrowLeft, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSearchTabs, type SettingsTabId } from './tabConfig';

const groups: { key: 'workspace' | 'account' | 'application'; tabs: SettingsTabId[] }[] = [
    { key: 'workspace', tabs: ['general', 'roast', 'team'] },
    { key: 'account', tabs: ['account', 'billing'] },
    { key: 'application', tabs: ['software', 'support'] },
];

export type SettingsNavigationProps = {
    activeTab: SettingsTabId;
    onTabChange: (tab: SettingsTabId) => void;
    onClose: () => void;
};

export function SettingsSidebar({
    activeTab,
    onTabChange,
    onClose,
    query,
    onQueryChange,
}: SettingsNavigationProps & {
    query: string;
    onQueryChange: (query: string) => void;
}) {
    const { t } = useTranslation();
    const tabs = getSearchTabs(t, query);
    return (
        <aside className="flex w-[170px] shrink-0 flex-col overflow-y-auto border-r border-border-subtle bg-primary/[0.02] px-3 py-5 sm:w-[200px] lg:w-[220px]">
            <div className="mb-4 flex items-center gap-1.5 px-1">
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t('settings.close')}
                    title={t('settings.close')}
                    className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-secondary transition-colors hover:bg-primary/5 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                >
                    <ArrowLeft size={16} strokeWidth={1.5} />
                </button>
                <p className="m-0 text-base font-semibold tracking-tight text-primary">{t('settings.pageTitle')}</p>
            </div>
            <div className="relative mb-5">
                <Search
                    size={15}
                    strokeWidth={1.5}
                    className="pointer-events-none absolute left-3 top-2.5 text-muted"
                    aria-hidden
                />
                <input
                    type="search"
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    aria-label={t('settings.search')}
                    placeholder={t('settings.search')}
                    className="h-9 w-full appearance-none rounded-full border border-border bg-primary/5 pl-9 pr-3 text-[13px] text-primary shadow-none outline-none placeholder:text-muted transition-colors focus-visible:border-primary/25 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                />
            </div>
            <nav aria-label={t('settings.pageTitle')} className="space-y-5">
                {groups
                    .filter((group) => group.tabs.some((id) => tabs.some((tab) => tab.id === id)))
                    .map((group) => (
                        <div key={group.key}>
                            <h2 className="m-0 mb-1.5 px-2.5 text-xs font-medium text-muted">
                                {t(`settings.groups.${group.key}`)}
                            </h2>
                            <div className="space-y-0.5">
                                {group.tabs.map((id) => {
                                    const tab = tabs.find((item) => item.id === id);
                                    if (!tab) return null;
                                    const Icon = tab.icon;
                                    return (
                                        <button
                                            key={id}
                                            type="button"
                                            onClick={() => onTabChange(id)}
                                            aria-current={activeTab === id ? 'page' : undefined}
                                            className={cn(
                                                'flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border-none px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary',
                                                activeTab === id
                                                    ? 'bg-primary/[0.07] font-medium text-primary'
                                                    : 'bg-transparent text-secondary',
                                            )}
                                        >
                                            <Icon size={16} strokeWidth={1.5} className="shrink-0" aria-hidden />
                                            <span>{tab.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                {tabs.length === 0 && (
                    <p role="status" className="m-0 px-2.5 text-xs leading-relaxed text-muted">
                        {t('settings.noSearchResults')}
                    </p>
                )}
            </nav>
        </aside>
    );
}
