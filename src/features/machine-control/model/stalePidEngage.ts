/** First sample after link attach: disengage PID the user did not turn on this session (reload / orphan sidecar). */
export const shouldStaleEngageSafeOff = (input: {
    sidecarConnected: boolean;
    roasting: boolean;
    pidState: string;
    userEngagedThisSession: boolean;
    handledForConnectGeneration: number;
    connectGeneration: number;
}): boolean => {
    if (!input.sidecarConnected || input.roasting) return false;
    if (input.userEngagedThisSession) return false;
    if (input.pidState !== 'running' && input.pidState !== 'holding') return false;
    if (input.handledForConnectGeneration >= input.connectGeneration) return false;
    return true;
};
