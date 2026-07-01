import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTabs, type SettingsTabId } from './tabConfig';

export type { SettingsTabId };

import { AccountSettingsTab } from './AccountSettingsTab';
import { BillingSettingsTab } from './BillingSettingsTab';
import { GeneralSettingsTab } from './GeneralSettingsTab';
import { RoastSettingsTab } from './RoastSettingsTab';
import { SoftwareSettingsTab } from './SoftwareSettingsTab';

interface SettingsModalProps {
    open: boolean;
    onClose: () => void;
    initialTab?: SettingsTabId;
}

export const SettingsModal = ({ open, onClose, initialTab }: SettingsModalProps) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab ?? 'general');
    const tabs = useMemo(() => getTabs(t), [t]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, onClose]);

    if (!open) {
        return null;
    }

    const activeConfig = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
    return (
        <ModalShell
            onClose={onClose}
            labelledBy="settings-modal-title"
            contentClassName="max-w-[920px] w-full h-[min(780px,calc(100vh-48px))] flex flex-col rounded-xl bg-white dark:bg-[#181d21] shadow-2xl border border-gray-200 dark:border-[#585d61] overflow-hidden"
        >
            <div className="flex items-center justify-between px-7 pt-6 pb-4 border-b border-gray-100 dark:border-[#585d61] bg-white dark:bg-[#181d21]">
                <h2
                    id="settings-modal-title"
                    className="text-[15px] font-semibold text-gray-900 dark:text-[#e5e5e5] m-0"
                >
                    {t('settings.title')}
                </h2>
                <button
                    onClick={onClose}
                    aria-label={t('settings.close')}
                    className="w-8 h-8 rounded-lg text-gray-400 dark:text-[#999] flex items-center justify-center hover:bg-gray-100 dark:hover:bg-[#262B31] hover:text-gray-600 dark:hover:text-[#ccc] transition-colors cursor-pointer shrink-0"
                >
                    <X size={16} strokeWidth={1.8} />
                </button>
            </div>

            <div className="grid grid-cols-[220px_minmax(0,1fr)] min-h-0 flex-1">
                <aside className="p-4 bg-[#F9FAFB] dark:bg-[#181D21] dark:border-r border-[#585D61] overflow-y-auto">
                    <div className="grid gap-1">
                        {tabs.map(({ id, label, icon: Icon }) => {
                            const active = id === activeTab;

                            return (
                                <button
                                    key={id}
                                    onClick={() => setActiveTab(id)}
                                    className={`flex items-center gap-3 w-full px-3.5 py-2.5 rounded-[10px] border-none cursor-pointer text-left transition-all duration-200 ${
                                        active
                                            ? 'bg-white dark:bg-[#262B31] shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                                            : 'bg-transparent hover:bg-gray-200 dark:hover:bg-[#181d21]'
                                    }`}
                                >
                                    <div
                                        className={`shrink-0 ${active ? 'text-[#111827] dark:text-[#e5e5e5]' : 'text-[#6B7280] dark:text-[#999]'}`}
                                    >
                                        <Icon size={16} strokeWidth={1.8} />
                                    </div>
                                    <span
                                        className={`text-[14px] ${
                                            active
                                                ? 'font-semibold text-[#111827] dark:text-[#e5e5e5]'
                                                : 'font-medium text-[#374151] dark:text-[#ccc]'
                                        }`}
                                    >
                                        {label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </aside>

                <div className="px-7 py-7 overflow-y-auto flex flex-col min-h-0 flex-1">
                    <div className="flex items-start gap-3.5 mb-6 shrink-0">
                        <div className="mt-0.5">
                            <h3 className="text-[18px] leading-snug font-semibold text-[#111827] dark:text-[#e5e5e5] m-0">
                                {activeConfig.title}
                            </h3>
                            <p className="text-[13px] text-[#6B7280] dark:text-[#999] mt-1 m-0">
                                {activeConfig.description}
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-2.5 min-h-0">
                        {activeTab === 'roast' && <RoastSettingsTab />}
                        {activeTab === 'account' && <AccountSettingsTab onClose={onClose} />}
                        {activeTab === 'billing' && <BillingSettingsTab />}
                        {activeTab === 'general' && <GeneralSettingsTab />}
                        {activeTab === 'software' && <SoftwareSettingsTab />}
                    </div>
                </div>
            </div>
        </ModalShell>
    );
};
