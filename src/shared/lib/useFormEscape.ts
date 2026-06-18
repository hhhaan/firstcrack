import { useEffect } from 'react';

/**
 * 전역 Escape 키를 감지해 onClose를 호출한다.
 * 모달이 열려 있을 때만 리스너를 등록하며, contentEditable/form 요소에서는 무시한다.
 */
export const useFormEscape = (open: boolean, onClose: () => void) => {
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onClose]);
};
