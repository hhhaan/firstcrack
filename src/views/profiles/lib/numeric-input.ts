export const NUMERIC_INPUT_PROPS = {
    type: 'text' as const,
    inputMode: 'numeric' as const,
    pattern: '[0-9]*',
} satisfies Partial<React.InputHTMLAttributes<HTMLInputElement>>;

const handleNumericBeforeInput = (e: React.FormEvent<HTMLInputElement>) => {
    const ev = e.nativeEvent as InputEvent;
    if (ev.data && !/^\d*$/.test(ev.data)) e.preventDefault();
};

const handleNumericPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (!/^\d+$/.test(e.clipboardData.getData('text/plain'))) e.preventDefault();
};

export const numericInputProps = {
    ...NUMERIC_INPUT_PROPS,
    onBeforeInput: handleNumericBeforeInput,
    onPaste: handleNumericPaste,
};
