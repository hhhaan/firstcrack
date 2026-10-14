import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { applyTimeEdit, commitEditTime, type TimeEditKind } from './time-edit';

/**
 * `mm:ss` mask for every `input[data-time-key]` inside the attached root.
 * Same keystroke rules as the heat-step editor: digits fill from the left, blur commits minutes to `mm:00`.
 */
export const useTimeEditRoot = (onValue: (key: string, value: string) => void) => {
    const onValueRef = useRef(onValue);
    useEffect(() => {
        onValueRef.current = onValue;
    });
    const [root, setRoot] = useState<HTMLElement | null>(null);
    const timeEdit = useRef(
        new WeakMap<HTMLInputElement, { suppress: boolean; secondsOpen: boolean; digits: string }>(),
    );
    const pasteClaimed = useRef(new WeakMap<HTMLInputElement, boolean>());
    const caretFix = useRef<{ el: HTMLInputElement; caret: number } | null>(null);

    useLayoutEffect(() => {
        const fix = caretFix.current;
        if (!fix) return;
        caretFix.current = null;
        const place = () => {
            if (fix.el.isConnected && document.activeElement === fix.el) {
                fix.el.setSelectionRange(fix.caret, fix.caret);
            }
        };
        place();
        requestAnimationFrame(place);
    });

    useEffect(() => {
        if (!root) return;
        const editTime = (input: HTMLInputElement, kind: TimeEditKind, text: string) => {
            const key = input.dataset.timeKey;
            if (!key) return;
            const start = input.selectionStart ?? 0;
            const end = input.selectionEnd ?? start;
            const prior = timeEdit.current.get(input);
            const res = applyTimeEdit(
                input.value,
                start,
                end,
                text,
                kind,
                prior?.suppress ?? false,
                prior?.secondsOpen ?? false,
                prior?.digits ?? '',
            );
            timeEdit.current.set(input, {
                suppress: res.suppress,
                secondsOpen: res.secondsOpen,
                digits: res.digits,
            });
            caretFix.current = { el: input, caret: res.caret };
            input.setSelectionRange(res.caret, res.caret);
            onValueRef.current(key, res.value);
        };
        const claimPaste = (input: HTMLInputElement, text: string) => {
            if (pasteClaimed.current.get(input)) return;
            pasteClaimed.current.set(input, true);
            queueMicrotask(() => pasteClaimed.current.set(input, false));
            editTime(input, 'insert', text);
        };
        const isTimeInput = (target: EventTarget | null): target is HTMLInputElement =>
            target instanceof HTMLInputElement && target.dataset.timeKey != null && !target.readOnly;
        const onBefore = (event: Event) => {
            if (!(event instanceof InputEvent) || !isTimeInput(event.target)) return;
            // Korean IME sends insertText while a syllable is still composing. Cancelling it
            // commits bare jamo and breaks the following text field.
            if (event.isComposing) return;
            const type = event.inputType;
            if (type === 'insertFromPaste') {
                event.preventDefault();
                claimPaste(event.target, event.data ?? '');
                return;
            }
            if (type === 'insertText' || type === 'insertReplacementText') {
                event.preventDefault();
                editTime(event.target, 'insert', event.data ?? '');
                return;
            }
            if (type === 'deleteContentBackward') {
                event.preventDefault();
                editTime(event.target, 'backspace', '');
                return;
            }
            if (type === 'deleteContentForward' || type === 'deleteByCut') {
                event.preventDefault();
                editTime(event.target, 'delete', '');
            }
        };
        const onPaste = (event: Event) => {
            if (!(event instanceof ClipboardEvent) || !isTimeInput(event.target)) return;
            event.preventDefault();
            claimPaste(event.target, event.clipboardData?.getData('text') ?? '');
        };
        const onBlur = (event: Event) => {
            if (!isTimeInput(event.target)) return;
            const committed = commitEditTime(event.target.value);
            if (committed === event.target.value) return;
            const key = event.target.dataset.timeKey;
            if (!key) return;
            timeEdit.current.set(event.target, { suppress: false, secondsOpen: false, digits: '' });
            onValueRef.current(key, committed);
        };
        root.addEventListener('beforeinput', onBefore);
        root.addEventListener('paste', onPaste);
        root.addEventListener('focusout', onBlur);
        return () => {
            root.removeEventListener('beforeinput', onBefore);
            root.removeEventListener('paste', onPaste);
            root.removeEventListener('focusout', onBlur);
        };
    }, [root]);

    return setRoot;
};
