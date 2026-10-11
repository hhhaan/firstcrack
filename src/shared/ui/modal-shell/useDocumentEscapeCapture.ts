import { useEffect } from 'react';

/** Document capture-phase keydown while `active` (runs before bubble handlers on nested controls). */
export const useDocumentEscapeCapture = (active: boolean, onKeyDown: (event: KeyboardEvent) => void) => {
    useEffect(() => {
        if (!active) return;
        const handler = (event: KeyboardEvent) => onKeyDown(event);
        document.addEventListener('keydown', handler, true);
        return () => document.removeEventListener('keydown', handler, true);
    }, [active, onKeyDown]);
};
