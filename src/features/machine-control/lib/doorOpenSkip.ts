/** Why a manual Charge or Drop did not send a door command. Null means record-only. */
export const doorOpenSkipReason = (input: {
    matched: boolean;
    switchOn: boolean;
    anySameKeySwitchOn: boolean;
    entitled: boolean;
    connected: boolean;
    reconnecting: boolean;
    supported: boolean;
}): string | null => {
    const expectsDoor = input.matched ? input.switchOn : input.anySameKeySwitchOn;
    if (!expectsDoor) return null;
    if (!input.matched) return '연결된 기기를 확정하지 못해 문을 움직이지 않았습니다.';
    if (!input.entitled) return '기기 제어 권한이 없어 문을 움직이지 않았습니다.';
    if (!input.connected || input.reconnecting) return '연결이 확정되지 않아 문을 움직이지 않았습니다.';
    if (!input.supported) return '문 제어가 켜지지 않아 명령을 보내지 않았습니다.';
    return null;
};
