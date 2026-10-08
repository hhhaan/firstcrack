import {
    eventToShortcut,
    formatShortcut,
    SHORTCUTS,
    type ShortcutId,
    useShortcutStore,
} from '@shared/store/keyboard-shortcuts';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { RotateCcw, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function KeyboardShortcutsModal() {
    const { t } = useTranslation();
    const { bindings, setBinding, resetBindings, setRecording, setDialogOpen } = useShortcutStore();
    const [query, setQuery] = useState('');
    const [editingId, setEditingId] = useState<ShortcutId | null>(null);
    const [error, setError] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const recordingButtonRef = useRef<HTMLButtonElement | null>(null);
    const changed = SHORTCUTS.some(({ id, defaultKeys }) => bindings[id].join('|') !== defaultKeys.join('|'));
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matches = SHORTCUTS.filter(({ id }) => {
        const text = `${t(`shortcuts.actions.${id}`)} ${formatShortcut(bindings[id])}`.toLocaleLowerCase();
        return terms.every((term) => text.includes(term));
    });

    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        searchRef.current?.focus();
        return () => {
            setRecording(false);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [setRecording]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (editingId) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (event.repeat || event.isComposing) return;
                if (event.key === 'Escape') {
                    setEditingId(null);
                    setError(null);
                    setRecording(false);
                    recordingButtonRef.current?.focus();
                    return;
                }
                const key = eventToShortcut(event);
                if (!key) return;
                const failure = setBinding(editingId, key);
                if (failure) {
                    setError(failure);
                    return;
                }
                setEditingId(null);
                setError(null);
                setRecording(false);
                recordingButtonRef.current?.focus();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                setDialogOpen(false);
            } else if (event.key === 'Tab') {
                const focusable = contentRef.current?.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input:not(:disabled)',
                );
                const first = focusable?.[0];
                const last = focusable?.[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [editingId, setBinding, setRecording, setDialogOpen]);

    return (
        <ModalShell
            onClose={() => setDialogOpen(false)}
            labelledBy="keyboard-shortcuts-title"
            contentClassName={modalPanel.formLg}
            data-testid="keyboard-shortcuts-modal"
        >
            <div ref={contentRef} className="flex min-h-0 flex-col">
                <ModalHeader
                    title={t('shortcuts.title')}
                    titleId="keyboard-shortcuts-title"
                    onClose={() => setDialogOpen(false)}
                    closeLabel={t('common.close')}
                    className="px-6 pt-6 pb-5"
                />
                <div className="px-6 pb-4">
                    <label className="flex items-center gap-2 rounded-xl border border-border bg-surface/50 px-3 py-2.5 text-muted">
                        <Search size={17} strokeWidth={1.5} aria-hidden />
                        <input
                            ref={searchRef}
                            type="search"
                            aria-label={t('shortcuts.search')}
                            placeholder={t('shortcuts.search')}
                            value={query}
                            onChange={(event) => setQuery(event.currentTarget.value)}
                            disabled={editingId !== null}
                            className="min-w-0 flex-1 bg-transparent text-[13px] text-primary outline-none placeholder:text-muted"
                        />
                    </label>
                    {editingId && (
                        <p role="status" className="m-0 mt-3 text-xs text-secondary">
                            {t('shortcuts.recordingHint')}
                        </p>
                    )}
                    {error && (
                        <p role="alert" className="m-0 mt-2 text-xs text-red-500">
                            {t(`shortcuts.errors.${error}`)}
                        </p>
                    )}
                </div>
                <div className="min-h-0 overflow-y-auto px-6 pb-4">
                    {(['app', 'roast', 'chart'] as const).map((group) => {
                        const rows = matches.filter((shortcut) => shortcut.group === group);
                        if (!rows.length) return null;
                        return (
                            <section key={group} className="mb-4 last:mb-0">
                                <h3 className="m-0 mb-2 text-xs font-medium text-muted">
                                    {t(`shortcuts.groups.${group}`)}
                                </h3>
                                {rows.map(({ id, editable }) => (
                                    <div key={id} className="flex min-h-12 items-center justify-between gap-4 py-2">
                                        <div className="min-w-0 text-[13px] text-primary">
                                            {t(`shortcuts.actions.${id}`)}
                                            {id === 'drop' && (
                                                <p className="m-0 mt-1 text-xs text-muted">
                                                    {t('shortcuts.doubleTap')}
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            data-shortcut={id}
                                            aria-label={t('shortcuts.change', { action: t(`shortcuts.actions.${id}`) })}
                                            aria-pressed={editingId === id}
                                            disabled={editable === false || (editingId !== null && editingId !== id)}
                                            title={editable === false ? t('shortcuts.fixed') : undefined}
                                            onClick={(event) => {
                                                recordingButtonRef.current = event.currentTarget;
                                                setEditingId(id);
                                                setError(null);
                                                setRecording(true);
                                            }}
                                            className="shrink-0 rounded-xl bg-surface px-3 py-2 text-xs text-secondary ring-primary/30 hover:text-primary aria-pressed:ring-2 disabled:cursor-default disabled:opacity-60 dark:bg-surface-elevated cursor-pointer"
                                        >
                                            <kbd className="whitespace-nowrap font-sans">
                                                {editingId === id
                                                    ? t('shortcuts.pressKeys')
                                                    : formatShortcut(bindings[id])}
                                            </kbd>
                                        </button>
                                    </div>
                                ))}
                            </section>
                        );
                    })}
                    {!matches.length && (
                        <p role="status" className="text-[13px] text-muted">
                            {t('shortcuts.noResults')}
                        </p>
                    )}
                </div>
                <footer className="border-t border-border-subtle px-6 py-4">
                    <button
                        type="button"
                        disabled={!changed || editingId !== null}
                        onClick={() => {
                            resetBindings();
                            setError(null);
                        }}
                        className="flex items-center gap-2 bg-transparent text-[13px] text-secondary hover:text-primary disabled:cursor-default disabled:opacity-40 cursor-pointer"
                    >
                        <RotateCcw size={15} strokeWidth={1.5} />
                        {t('shortcuts.restore')}
                    </button>
                </footer>
            </div>
        </ModalShell>
    );
}
