import { useEffect, useMemo, useState } from 'react';
import { Shield, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { getTabs, type SettingsTabId } from './tabConfig';
export type { SettingsTabId };
import { RoastSettingsTab } from './RoastSettingsTab';
import { AccountSettingsTab } from './AccountSettingsTab';
import { GeneralSettingsTab } from './GeneralSettingsTab';

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

    useEffect(() => {
        if (open) {
            setActiveTab(initialTab ?? 'general');
        }
    }, [open, initialTab]);

    if (!open) {
        return null;
    }

    const activeConfig = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
    const ActiveIcon = activeConfig.icon;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="settings-modal-title"
            contentClassName="max-w-[920px] w-full max-h-[min(780px,calc(100vh-48px))] flex flex-col rounded-3xl bg-[rgba(255,255,255,0.95)] shadow-[0_24px_60px_rgba(22,18,12,0.2)] border border-[rgba(0,0,0,0.08)] overflow-hidden"
        >
            <div className="flex items-start justify-between gap-4 px-7 pt-7 pb-5 border-b border-border-subtle bg-linear-to-b from-[rgba(248,245,240,0.72)] to-[rgba(255,255,255,0.92)]">
                <div>
                    <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-surface-warm-solid text-secondary text-xs font-semibold tracking-[0.12px] mb-3.5">
                        <Shield size={14} strokeWidth={1.8} />
                        {t('settings.title')}
                    </div>
                    <h2 id="settings-modal-title" className="m-0 text-[0px] leading-0">
                        {t('settings.title')}
                    </h2>
                </div>

                <button
                    onClick={onClose}
                    aria-label={t('settings.close')}
                    className="w-9 h-9 rounded-[10px] border-none bg-surface text-muted flex items-center justify-center cursor-pointer shrink-0 shadow-inset"
                >
                    <X size={16} strokeWidth={1.9} />
                </button>
            </div>

            <div className="grid grid-cols-[240px_minmax(0,1fr)] min-h-0 flex-1">
                <aside className="p-5 border-r border-border-subtle bg-[rgba(247,244,240,0.64)] overflow-y-auto">
                    <div className="grid gap-2 p-1.5 rounded-[20px] bg-[rgba(255,255,255,0.55)] shadow-inset">
                        {tabs.map(({ id, label, icon: Icon }) => {
                            const active = id === activeTab;

                            return (
                                <button
                                    key={id}
                                    onClick={() => setActiveTab(id)}
                                    className={`flex items-center gap-2.5 w-full px-3.5 py-3 rounded-[14px] border-none cursor-pointer text-left transition-all duration-[0.18s] ease-in-out ${
                                        active
                                            ? 'bg-[rgba(255,255,255,0.96)] text-primary shadow-card'
                                            : 'bg-transparent text-secondary shadow-none'
                                    }`}
                                >
                                    <div
                                        className={`w-8.5 h-[34px] rounded-[10px] flex items-center justify-center shadow-inset shrink-0 ${
                                            active
                                                ? 'bg-surface-warm-solid text-primary'
                                                : 'bg-[rgba(255,255,255,0.72)] text-muted'
                                        }`}
                                    >
                                        <Icon size={16} strokeWidth={1.8} />
                                    </div>
                                    <div>
                                        <div className="text-sm font-semibold tracking-[0.12px]">{label}</div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </aside>

                <div className="p-6 overflow-y-auto">
                    <div className="flex items-start gap-3.5 mb-5">
                        <div className="w-11 h-11 rounded-[14px] bg-surface-warm-solid flex items-center justify-center text-primary shadow-warm shrink-0">
                            <ActiveIcon size={20} strokeWidth={1.9} />
                        </div>
                        <div>
                            <h3 className="text-2xl leading-[1.1] font-semibold text-primary mb-2 tracking-[-0.03em]">
                                {activeConfig.title}
                            </h3>
                            <p className="text-sm text-secondary max-w-140">{activeConfig.description}</p>
                        </div>
                    </div>

                    <div className="grid gap-4">
                        {activeTab === 'roast' && <RoastSettingsTab />}

                        {activeTab === 'account' && <AccountSettingsTab onClose={onClose} />}

                        {activeTab === 'general' && <GeneralSettingsTab />}

                        {activeConfig.cards.map((card) => (
                            <section
                                key={card.title}
                                className="rounded-[20px] p-5 bg-linear-to-b from-[rgba(245,242,239,0.75)] to-[rgba(255,255,255,0.92)] border border-[rgba(0,0,0,0.06)] shadow-warm"
                            >
                                <div className="mb-3.5">
                                    <h4 className="text-base font-semibold text-primary mb-1">{card.title}</h4>
                                    <p className="text-[13px] text-secondary">{card.description}</p>
                                </div>

                                <div className="grid gap-2.5">
                                    {card.items.map((item) => (
                                        <label
                                            key={item}
                                            className="flex items-center gap-3 px-3.5 py-3 rounded-[14px] bg-[rgba(255,255,255,0.88)] shadow-inset text-secondary text-[13px]"
                                        >
                                            <input type="checkbox" defaultChecked className="accent-[#6f4e37]" />
                                            <span>{item}</span>
                                        </label>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                </div>
            </div>
        </ModalShell>
    );
};
