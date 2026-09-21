import type { Theme } from '@shared/store/theme';
import { useThemeStore } from '@shared/store/theme';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Monitor, Moon, Sun } from 'lucide-react';

const themeOptions: { value: Theme; icon: typeof Sun; label: string; desc: string }[] = [
    { value: 'light', icon: Sun, label: 'Light', desc: 'Bright and clean interface' },
    { value: 'dark', icon: Moon, label: 'Dark', desc: 'Easier on the eyes' },
    { value: 'system', icon: Monitor, label: 'System', desc: 'Follow your OS setting' },
];

const cardCls = (active: boolean) =>
    `flex flex-col items-center gap-3 p-6 rounded-xl border-2 cursor-pointer transition-all shrink-0 w-44 ${
        active
            ? 'border-[#111827] bg-[#F9FAFB] dark:border-white dark:bg-[#262B31]'
            : 'border-[#E5E7EB] bg-white dark:border-[#585d61] dark:bg-[#181d21] hover:border-[#9CA3AF] dark:hover:border-[#585d61]'
    }`;

/** VOC: restore dark/system — re-mount from App.tsx (`theme === null`). */
export const ThemeSelectModal = () => {
    const setTheme = useThemeStore((s) => s.setTheme);

    const handleSelect = (t: Theme) => {
        setTheme(t);
    };

    return (
        <ModalShell
            onClose={() => {}}
            labelledBy="theme-select-title"
            contentClassName="max-w-[580px] w-full flex flex-col items-center gap-6 rounded-xl bg-white dark:bg-[#181d21] shadow-2xl border border-gray-200 dark:border-[#585d61] p-8"
        >
            <div className="flex flex-col items-center gap-2 text-center">
                <h2
                    id="theme-select-title"
                    className="text-[18px] font-semibold text-[#111827] dark:text-[#e5e5e5] m-0"
                >
                    Choose your theme
                </h2>
                <p className="text-[13px] text-[#6B7280] dark:text-[#999] m-0">
                    You can change this anytime in workspace settings.
                </p>
            </div>

            <div className="flex gap-4">
                {themeOptions.map(({ value, icon: Icon, label, desc }) => (
                    <button type="button" key={value} onClick={() => handleSelect(value)} className={cardCls(false)}>
                        <Icon size={28} strokeWidth={1.5} className="text-[#111827] dark:text-[#e5e5e5]" />
                        <div className="text-center">
                            <div className="text-[14px] font-semibold text-[#111827] dark:text-[#e5e5e5]">{label}</div>
                            <div className="text-[11px] text-[#6B7280] dark:text-[#999] mt-0.5">{desc}</div>
                        </div>
                    </button>
                ))}
            </div>
        </ModalShell>
    );
};
