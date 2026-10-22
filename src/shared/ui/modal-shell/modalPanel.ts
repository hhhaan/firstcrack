/**
 * Shared dialog surface tokens for ModalShell `contentClassName`.
 * Keep visual chrome here — callers pass size key, not raw shadow/border strings.
 */

const formChrome =
    'w-full flex flex-col rounded-[16px] bg-[rgba(255,255,255,0.97)] dark:bg-main-bg dark:[&_*]:!text-white backdrop-[blur(20px)_saturate(180%)] shadow-[0_32px_80px_rgba(22,18,12,0.25)] border border-white dark:border-border overflow-hidden';

export const modalPanel = {
    /** Confirm / scope / stock dialogs (~420px) */
    sm: 'max-w-[420px] w-full bg-main-bg dark:bg-main-bg dark:[&_*]:!text-white rounded-[16px] p-7 shadow-[rgba(0,0,0,0.22)_0px_24px_64px,rgba(0,0,0,0.06)_0px_0px_0px_1px] border border-transparent dark:border-border',
    /** Compact forms (~520px): product, order, channel, dispatch */
    formSm: `max-w-[520px] max-h-[min(720px,calc(100vh-64px))] ${formChrome}`,
    /** Standard forms (~600px): batch, blend */
    formMd: `max-w-[600px] max-h-[min(840px,calc(100vh-64px))] ${formChrome}`,
    /** Large forms (~640–680px): bean, profile, machine */
    formLg: `max-w-[680px] max-h-[min(860px,calc(100vh-56px))] ${formChrome}`,
    /** Connection and sensor settings side by side. */
    formXl: `max-w-[880px] max-h-[min(860px,calc(100vh-56px))] ${formChrome}`,
    /** Multi-session / multi-profile compare workspace */
    compare: `max-w-[1120px] h-[min(900px,calc(100vh-40px))] ${formChrome}`,
    /** Roast history: chart, sensor controls and batch comparison table. */
    compareWorkspace:
        'w-full max-w-[1440px] max-h-[calc(100dvh-48px)] flex flex-col overflow-hidden rounded-2xl border border-border bg-main-bg shadow-2xl',
    /** Workspace settings (sidebar layout) */
    settings:
        'max-w-[920px] w-full h-[min(780px,calc(100vh-48px))] flex flex-col rounded-xl bg-white dark:bg-main-bg shadow-2xl border border-border dark:border-border overflow-hidden',
} as const;

export type ModalPanelSize = keyof typeof modalPanel;
