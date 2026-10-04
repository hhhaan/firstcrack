import { DEFAULT_BEAN_KEY } from '@features/active-roast/lib/constants';
import { isChargedPhase, selectRoastSelection } from '@features/active-roast/model/batch';
import { useRoastingStore } from '@features/active-roast/model/status';
import { logger } from '@shared/lib/logger';
import type { Bean } from '@shared/types/database.types';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

interface UserProfile {
    default_roast_profile_id?: string | null;
}

export interface UseRoastProfileSelectionParams {
    isActive: boolean;
    charged: boolean;
    userProfile: UserProfile | null | undefined;
    /** Inventory beans for the active workspace — used to invalidate stale ids (#176). */
    beans?: Pick<Bean, 'id'>[];
    /** Must be true before clearing — prevents wipe during loading placeholder. */
    beansReady?: boolean;
    /**
     * Replay On이면 타겟을 바꾸기 전에 확인. false면 적용하지 않는다.
     * 기본 프로파일 초기 세팅은 이 게이트를 타지 않는다.
     */
    confirmTargetChange?: (nextId: string | null) => boolean | Promise<boolean>;
    /**
     * 승인 직후, 타겟 state를 바꾸기 전. Replay stop → 미전송 취소가 여기 있다.
     * 자동 재시작은 하지 않는다.
     */
    commitApprovedTarget?: (nextId: string | null) => void;
    /**
     * Charge 전 사용자 선택만 계정 기본값으로 저장한다.
     * 자동 초기값·pending·스케줄 핸드오프는 호출하지 않는다.
     */
    saveDefaultProfile?: (id: string | null) => void;
    /**
     * 진행 중 확인·디바운스 저장을 무효화한다 (workspace + batch/session).
     * 바뀐 뒤에 도착한 승인이나 저장은 새 배치를 덮지 않는다.
     */
    selectionEpoch?: string;
    workspaceOwnerId?: string | null;
}

export interface UseRoastProfileSelectionReturn {
    targetProfileId: string | null;
    setTargetProfileId: (id: string | null) => void;
    selectedBeanId: string | null;
    setSelectedBeanId: (id: string | null) => void;
    handoffBeanName: string | null;
    setUserSelectedTarget: (id: string | null) => void;
}

const DEFAULT_PROFILE_SAVE_MS = 300;

export const useRoastProfileSelection = (params: UseRoastProfileSelectionParams): UseRoastProfileSelectionReturn => {
    const {
        isActive,
        charged,
        userProfile,
        beans = [],
        beansReady = false,
        confirmTargetChange,
        commitApprovedTarget,
        saveDefaultProfile,
        selectionEpoch = '',
        workspaceOwnerId,
    } = params;
    const selection = useRoastingStore(selectRoastSelection);
    const pendingProfileId = useRoastingStore((state) => state.pendingProfileId);
    const chargedRef = useRef(charged);
    const confirmTargetChangeRef = useRef(confirmTargetChange);
    const commitApprovedTargetRef = useRef(commitApprovedTarget);
    const saveDefaultProfileRef = useRef(saveDefaultProfile);
    const selectionEpochRef = useRef(selectionEpoch);
    const requestGenRef = useRef(0);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useLayoutEffect(() => {
        chargedRef.current = charged;
        confirmTargetChangeRef.current = confirmTargetChange;
        commitApprovedTargetRef.current = commitApprovedTarget;
        saveDefaultProfileRef.current = saveDefaultProfile;
        selectionEpochRef.current = selectionEpoch;
    }, [charged, confirmTargetChange, commitApprovedTarget, saveDefaultProfile, selectionEpoch]);
    useEffect(() => {
        if (workspaceOwnerId !== undefined) useRoastingStore.getState().prepareWorkspace(workspaceOwnerId);
    }, [workspaceOwnerId]);
    // Approval and default writes belong to this mounted view and selection epoch.
    // biome-ignore lint/correctness/useExhaustiveDependencies: epoch invalidates pending approvals and writes
    useEffect(
        () => () => {
            requestGenRef.current += 1;
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        },
        [selectionEpoch],
    );
    const applyTarget = useCallback(async (id: string | null, source: 'user' | 'handoff') => {
        const before = useRoastingStore.getState();
        if (id === selectRoastSelection(before).profileId) return true;
        const gen = ++requestGenRef.current;
        const epoch = selectionEpochRef.current;
        const gate = confirmTargetChangeRef.current;
        if (gate && !(await gate(id))) return false;
        const current = useRoastingStore.getState();
        if (
            gen !== requestGenRef.current ||
            epoch !== selectionEpochRef.current ||
            current.sessionId !== before.sessionId ||
            current.prepared.workspaceOwnerId !== before.prepared.workspaceOwnerId
        )
            return;
        // No await between stopping Replay and committing the approved selection.
        commitApprovedTargetRef.current?.(id);
        if (!current.commitProfile(id, before.sessionId, before.prepared.workspaceOwnerId)) return;
        if (source === 'user' && !chargedRef.current && !isChargedPhase(current.phase)) {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => {
                saveTimerRef.current = null;
                if (selectionEpochRef.current !== epoch) return;
                const state = useRoastingStore.getState();
                if (
                    state.sessionId !== before.sessionId ||
                    state.prepared.workspaceOwnerId !== before.prepared.workspaceOwnerId
                )
                    return;
                saveDefaultProfileRef.current?.(id);
            }, DEFAULT_PROFILE_SAVE_MS);
        }
        return true;
    }, []);
    useEffect(() => {
        if (chargedRef.current || userProfile === undefined) return;
        useRoastingStore.getState().initializeProfile(userProfile?.default_roast_profile_id ?? null);
    }, [userProfile]);
    useEffect(() => {
        if (!isActive || charged) return;
        const store = useRoastingStore.getState();
        if (store.pendingBeanId) {
            store.prepareBean(store.pendingBeanId, store.pendingBeanName);
            store.setPendingBean(null);
        }
        if (!store.prepared.beanInitialized) {
            try {
                store.initializeBean(localStorage.getItem(DEFAULT_BEAN_KEY));
            } catch (err) {
                logger.capture(err, { scope: 'roastProfileSelection.readDefaultBean' });
                store.initializeBean(null);
            }
        }
    }, [isActive, charged]);
    useEffect(() => {
        if (!isActive || charged || !pendingProfileId) return;
        if (useRoastingStore.getState().pendingProfileId !== pendingProfileId) return;
        void applyTarget(pendingProfileId, 'handoff').then((result) => {
            const store = useRoastingStore.getState();
            if (result !== undefined && store.pendingProfileId === pendingProfileId) store.setPendingProfile(null);
        });
    }, [isActive, charged, pendingProfileId, applyTarget]);
    useEffect(() => {
        if (charged || !beansReady || !selection.beanId || selection.beanName) return;
        if (beans.some((bean) => bean.id === selection.beanId)) return;
        useRoastingStore.getState().prepareBean(null);
        try {
            localStorage.removeItem(DEFAULT_BEAN_KEY);
        } catch (err) {
            logger.capture(err, { scope: 'roastProfileSelection.clearDefaultBean' });
        }
    }, [charged, beansReady, beans, selection.beanId, selection.beanName]);
    const setUserSelectedTarget = useCallback(
        (id: string | null) => {
            void applyTarget(id, 'user');
        },
        [applyTarget],
    );
    const setSelectedBeanId = useCallback((id: string | null) => {
        const store = useRoastingStore.getState();
        store.prepareBean(id, id ? null : store.prepared.beanName);
    }, []);
    return {
        targetProfileId: selection.profileId,
        selectedBeanId: selection.beanId,
        handoffBeanName: selection.beanName,
        setSelectedBeanId,
        setTargetProfileId: setUserSelectedTarget,
        setUserSelectedTarget,
    };
};
