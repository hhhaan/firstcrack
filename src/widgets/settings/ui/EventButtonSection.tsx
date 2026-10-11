import {
    CUSTOM_EVENT_LIMIT,
    type EventNameError,
    effectiveCustomShortcuts,
    eventNameError,
    nextCustomEventShortcut,
} from '@features/active-roast/lib/event-buttons';
import { updateRoastSettings, useRoastSettings } from '@features/active-roast/model/settings';
import { markDropLabel, roastEventLabel } from '@shared/i18n/roast-event-label';
import {
    eventToShortcut,
    formatShortcut,
    type ShortcutBindingResult,
    shortcutBindingError,
    useShortcutStore,
} from '@shared/store/keyboard-shortcuts';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsCheckRow } from './SettingsOptionRow';
import { SettingsSection } from './SettingsSection';

const nameInputCls =
    'h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-3 text-xs text-primary outline-none focus:border-primary';
const addBtnCls =
    'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-transparent px-3 text-[13px] font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';
const shortcutBtnCls =
    'inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md bg-transparent px-2 text-xs text-secondary ring-primary/30 hover:bg-surface hover:text-primary focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-surface aria-pressed:ring-2 disabled:cursor-default disabled:opacity-40';

export function EventButtonSection() {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const buttons = useRoastSettings().eventButtons;
    const bindings = useShortcutStore((state) => state.bindings);
    const dialogOpen = useShortcutStore((state) => state.dialogOpen);
    const setRecording = useShortcutStore((state) => state.setRecording);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<EventNameError | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [shortcutError, setShortcutError] = useState<Exclude<ShortcutBindingResult, undefined> | null>(null);
    const buttonsRef = useRef(buttons);
    buttonsRef.current = buttons;
    const atLimit = buttons.custom.length >= CUSTOM_EVENT_LIMIT;
    const takenGlobals = Object.values(bindings).flat();
    const liveShortcuts = effectiveCustomShortcuts(buttons.custom, takenGlobals);

    const save = (next: typeof buttons) => updateRoastSettings({ eventButtons: next });

    const add = () => {
        const nameError = eventNameError(
            draft,
            buttons.custom.map((item) => item.name),
            atLimit,
        );
        if (nameError) {
            setError(nameError);
            return;
        }
        const shortcut = nextCustomEventShortcut([
            ...takenGlobals,
            ...liveShortcuts.filter((key): key is string => Boolean(key)),
        ]);
        save({
            ...buttons,
            custom: [
                ...buttons.custom,
                {
                    id: crypto.randomUUID(),
                    name: draft.trim(),
                    enabled: true,
                    ...(shortcut ? { shortcut } : {}),
                },
            ],
        });
        setDraft('');
        setError(null);
    };

    useEffect(() => {
        if (!dialogOpen) return;
        setEditingId(null);
        setShortcutError(null);
    }, [dialogOpen]);

    useEffect(() => {
        if (!editingId) return;
        setRecording(true);
        const onKey = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.repeat || event.isComposing) return;
            if (event.key === 'Escape') {
                setEditingId(null);
                setShortcutError(null);
                setRecording(false);
                return;
            }
            const key = eventToShortcut(event);
            if (!key) return;
            const current = buttonsRef.current;
            const globals = Object.values(useShortcutStore.getState().bindings).flat();
            const others = effectiveCustomShortcuts(
                current.custom.filter((row) => row.id !== editingId),
                globals,
            ).filter((item): item is string => Boolean(item));
            const failure = shortcutBindingError(key, [...globals, ...others]);
            if (failure) {
                setShortcutError(failure);
                return;
            }
            updateRoastSettings({
                eventButtons: {
                    ...current,
                    custom: current.custom.map((row) => (row.id === editingId ? { ...row, shortcut: key } : row)),
                },
            });
            setEditingId(null);
            setShortcutError(null);
            setRecording(false);
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            setRecording(false);
        };
    }, [editingId, setRecording]);

    return (
        <SettingsSection group="events">
            <SettingsSection.Header title={tk('eventButtons')} description={tk('eventButtonsDescription')} />
            <SettingsSection.Body>
                <SettingsCheckRow
                    checked={buttons.yellow}
                    label={roastEventLabel('Yellow')}
                    onChange={() => save({ ...buttons, yellow: !buttons.yellow })}
                />
                <SettingsCheckRow
                    checked={buttons.fcStart}
                    label={roastEventLabel('FC Start')}
                    onChange={() => save({ ...buttons, fcStart: !buttons.fcStart })}
                />
                <SettingsCheckRow
                    checked={buttons.fcEnd}
                    label={roastEventLabel('FC End')}
                    onChange={() => save({ ...buttons, fcEnd: !buttons.fcEnd })}
                />
                <SettingsCheckRow checked disabled label={markDropLabel()} onChange={() => undefined} />
                <div className="flex items-center gap-2 py-2">
                    <input
                        value={draft}
                        maxLength={16}
                        placeholder={tk('eventButtonName')}
                        aria-label={tk('eventButtonName')}
                        aria-invalid={error != null}
                        aria-describedby={error ? 'event-button-name-error' : undefined}
                        className={nameInputCls}
                        onChange={(event) => {
                            setDraft(event.target.value);
                            if (error) setError(null);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                add();
                            }
                        }}
                    />
                    <button type="button" className={addBtnCls} disabled={atLimit} onClick={add}>
                        {tk('eventButtonAdd')}
                    </button>
                </div>
                {error ? (
                    <p id="event-button-name-error" role="alert" className="m-0 text-xs text-red-600 dark:text-red-400">
                        {tk(error === 'limit' ? 'eventButtonLimit' : 'eventButtonNameInvalid')}
                    </p>
                ) : null}
                {buttons.custom.map((item, index) => {
                    const live = liveShortcuts[index];
                    const storedConflict = Boolean(item.shortcut) && !live && editingId !== item.id;
                    return (
                        <div key={item.id}>
                            <div className="flex items-start gap-2.5 py-2">
                                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                                    <input
                                        type="checkbox"
                                        checked={item.enabled}
                                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                                        onChange={() =>
                                            save({
                                                ...buttons,
                                                custom: buttons.custom.map((row) =>
                                                    row.id === item.id ? { ...row, enabled: !row.enabled } : row,
                                                ),
                                            })
                                        }
                                    />
                                    <span className="min-w-0 flex-1 text-[13px] font-medium text-primary">
                                        {item.name}
                                    </span>
                                </label>
                                <button
                                    type="button"
                                    className={shortcutBtnCls}
                                    aria-label={t('shortcuts.change', { action: item.name })}
                                    aria-pressed={editingId === item.id}
                                    disabled={dialogOpen || (editingId !== null && editingId !== item.id)}
                                    onClick={() => {
                                        setEditingId(item.id);
                                        setShortcutError(null);
                                    }}
                                >
                                    <kbd className="whitespace-nowrap font-sans">
                                        {editingId === item.id
                                            ? t('shortcuts.pressKeys')
                                            : live
                                              ? formatShortcut(live)
                                              : item.shortcut
                                                ? formatShortcut(item.shortcut)
                                                : tk('eventButtonShortcutUnset')}
                                    </kbd>
                                </button>
                                <button
                                    type="button"
                                    className="cursor-pointer rounded-md border-none bg-transparent p-1.5 text-[#9CA3AF] hover:text-red-600"
                                    aria-label={tk('eventButtonRemove')}
                                    onClick={() =>
                                        save({
                                            ...buttons,
                                            custom: buttons.custom.filter((row) => row.id !== item.id),
                                        })
                                    }
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                            {editingId === item.id && shortcutError ? (
                                <p role="alert" className="m-0 pb-1 text-xs text-red-600 dark:text-red-400">
                                    {t(`shortcuts.errors.${shortcutError}`)}
                                </p>
                            ) : null}
                            {storedConflict ? (
                                <p role="alert" className="m-0 pb-1 text-xs text-red-600 dark:text-red-400">
                                    {t('shortcuts.errors.conflict')}
                                </p>
                            ) : null}
                        </div>
                    );
                })}
                {editingId ? (
                    <p role="status" className="m-0 text-xs text-secondary">
                        {t('shortcuts.recordingHint')}
                    </p>
                ) : null}
            </SettingsSection.Body>
        </SettingsSection>
    );
}
