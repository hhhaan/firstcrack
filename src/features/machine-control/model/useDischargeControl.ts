import { captureDoorWriteNoResponse } from '@shared/lib/sentry';
import { isSidecarHttpError, sidecar } from '@shared/lib/sidecar';
import { useToastStore } from '@shared/store/toast';
import { useCallback, useState } from 'react';
import { createDoorGate, type DoorGate } from '../lib/doorGate';

type DoorTarget = Parameters<typeof sidecar.setFill>[1];

const sent = (action: 'open' | 'close') =>
    `배출문 ${action === 'open' ? '열기' : '닫기'} 명령을 보냈습니다. 문 위치는 확인하지 않습니다.`;

export const useDischargeControl = (available: boolean, gate?: DoorGate, target?: DoorTarget) => {
    const [localGate] = useState(createDoorGate);
    const doorGate = gate ?? localGate;
    const [sending, setSending] = useState(false);
    const send = useCallback(
        async (action: 'open' | 'close') => {
            if (!available) {
                useToastStore.getState().show('연결된 기기의 문 제어를 사용할 수 없습니다.', 'error');
                return false;
            }
            if (!doorGate.tryBegin()) {
                useToastStore.getState().show('다른 문 명령을 보내는 중입니다. 이 요청은 보내지 않습니다.', 'error');
                return false;
            }
            setSending(true);
            try {
                await sidecar.setDischarge(action, target);
                // The PLC acknowledges the write, not the physical door position.
                useToastStore.getState().show(sent(action), 'success');
                return true;
            } catch (error) {
                if (isSidecarHttpError(error) && (error.status === 'network' || error.status === 'timeout')) {
                    captureDoorWriteNoResponse({ door: 'discharge', action });
                }
                useToastStore
                    .getState()
                    .show('배출문 응답에 실패했습니다. 동작 확인이 필요합니다. 조작반에서 확인하세요.', 'error');
                return false;
            } finally {
                doorGate.end();
                setSending(false);
            }
        },
        [available, doorGate, target],
    );
    return { available, sending, send };
};
