/** Product feature keys — single catalog. Add keys here before gating UI. */
export const FEATURE = {
    cupping: 'cupping',
    orderIntegration: 'orderIntegration',
    bbp: 'bbp',
    roastedInventory: 'roastedInventory',
    productStock: 'productStock',
    /** Shared workspace / team invites — enterprise-class only. */
    team: 'team',
    /** 500ms live poll rate — Pro core level (free/read_only run at 1s). */
    fastPolling: 'fastPolling',
    /**
     * 머신 쓰기 제어 — 수동 setpoint 슬라이더 + 소프트웨어 PID. Pro+ 이상.
     *
     * 게이트는 UI에만 걸린다. 사이드카는 로컬 프로세스라 플랜을 알지 못하므로
     * 서버처럼 강제할 수 없다 (fastPolling과 동일한 한계).
     */
    machineControl: 'machineControl',
    /**
     * 커스텀 머신 write_map / PID 게인 입력. Enterprise-class only.
     * 로스팅 중 제어 UI는 machineControl (Pro+)이 별도로 게이트한다.
     */
    customMachineControl: 'customMachineControl',
} as const;

export type FeatureKey = (typeof FEATURE)[keyof typeof FEATURE];
