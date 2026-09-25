import { subscribeOptimisticIdReplaced } from '@shared/lib/optimistic-id';
import { useEffect, useRef } from 'react';

/** When a created lot's temp id is replaced, move any selection still holding it. */
export const useOptimisticBeanSelection = (id: string | null, setId: (next: string) => void) => {
    const idRef = useRef(id);
    const setRef = useRef(setId);
    useEffect(() => {
        idRef.current = id;
        setRef.current = setId;
    });
    useEffect(
        () =>
            subscribeOptimisticIdReplaced((from, to) => {
                if (idRef.current === from) setRef.current(to);
            }),
        [],
    );
};
