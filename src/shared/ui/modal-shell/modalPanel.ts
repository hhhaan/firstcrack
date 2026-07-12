/**
 * Shared dialog surface tokens for ModalShell `contentClassName`.
 * Keep visual chrome here — callers pass size key, not raw shadow/border strings.
 */
export const modalPanel = {
    /** Confirm / scope / stock dialogs (~420px) */
    sm: 'max-w-[420px] w-full bg-main-bg dark:bg-[#181d21] dark:[&_*]:!text-white rounded-[16px] p-7 shadow-[rgba(0,0,0,0.22)_0px_24px_64px,rgba(0,0,0,0.06)_0px_0px_0px_1px] border border-transparent dark:border-[#585d61]',
    /** Workspace settings (sidebar layout) */
    settings:
        'max-w-[920px] w-full h-[min(780px,calc(100vh-48px))] flex flex-col rounded-xl bg-white dark:bg-[#181d21] shadow-2xl border border-gray-200 dark:border-[#585d61] overflow-hidden',
} as const;

export type ModalPanelSize = keyof typeof modalPanel;
