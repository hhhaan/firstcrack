import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { useToastStore } from '@shared/store/toast';
import { useCallback, useRef, useState } from 'react';

export const useDischargeControl = (available: boolean) => {
    const inFlight = useRef(false);
    const [sending, setSending] = useState(false);
    const send = useCallback(
        async (action: 'open' | 'close') => {
            if (!available) return false;
            if (inFlight.current) {
                useToastStore.getState().show('배출문 명령 전송 중입니다. 조작반에서 확인하세요.', 'error');
                return false;
            }
            inFlight.current = true;
            setSending(true);
            try {
                await sidecar.setDischarge(action);
                // The PLC acknowledges the write, not the physical door position.
                useToastStore
                    .getState()
                    .show(`배출문 ${action === 'open' ? '열기' : '닫기'} 명령을 보냈습니다.`, 'success');
                return true;
            } catch (error) {
                logger.capture(error, { feature: 'machine-control', action: 'discharge' });
                useToastStore.getState().show('배출문 명령을 확인하지 못했습니다. 조작반에서 확인하세요.', 'error');
                return false;
            } finally {
                inFlight.current = false;
                setSending(false);
            }
        },
        [available],
    );
    return { available, sending, send };
};
