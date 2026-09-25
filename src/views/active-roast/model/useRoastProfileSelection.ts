import { useOptimisticBeanSelection } from '@entities/bean/model/useOptimisticBeanSelection';
import { DEFAULT_BEAN_KEY } from '@features/active-roast/lib/constants';
import { useRoastingStore } from '@features/active-roast/model/status';
import { logger } from '@shared/lib/logger';
import {
    optimisticReplacementSource,
    optimisticReplacementTarget,
    subscribeOptimisticIdReplaced,
} from '@shared/lib/optimistic-id';
import { useRoastSessionStore } from '@shared/store/roastSession';
import type { Bean } from '@shared/types/database.types';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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
    } = params;

    const [targetProfileId, setTargetProfileId] = useState<string | null>(null);
    const userSelectedTargetRef = useRef(false);
    const [selectedBeanId, setSelectedBeanId] = useState<string | null>(() => {
        try {
            return localStorage.getItem(DEFAULT_BEAN_KEY);
        } catch (err) {
            logger.capture(err, { scope: 'roastProfileSelection.readDefaultBean' });
            return null;
        }
    });
    const [handoffBeanName, setHandoffBeanName] = useState<string | null>(null);
    const appliedDefaultBeanRef = useRef(Boolean(selectedBeanId));

    useOptimisticBeanSelection(selectedBeanId, setSelectedBeanId);
    useEffect(
        () =>
            subscribeOptimisticIdReplaced((from, to) => {
                try {
                    if (localStorage.getItem(DEFAULT_BEAN_KEY) === from) localStorage.setItem(DEFAULT_BEAN_KEY, to);
                } catch (err) {
                    logger.capture(err, { scope: 'roastProfileSelection.rewriteDefaultBean' });
                }
                const roast = useRoastingStore.getState();
                if (roast.pendingBeanId === from) roast.setPendingBean(to, roast.pendingBeanName);
                const session = useRoastSessionStore.getState();
                if (session.planBatchHandoff?.beanId === from) {
                    session.startBatch({ ...session.planBatchHandoff, beanId: to });
                }
                if (session.lastAdhocSave?.beanId === from) {
                    session.recordAdhocSave({ ...session.lastAdhocSave, beanId: to });
                }
            }),
        [],
    );

    const chargedRef = useRef(charged);
    const targetProfileIdRef = useRef(targetProfileId);
    const confirmTargetChangeRef = useRef(confirmTargetChange);
    const commitApprovedTargetRef = useRef(commitApprovedTarget);
    const saveDefaultProfileRef = useRef(saveDefaultProfile);
    const selectionEpochRef = useRef(selectionEpoch);
    const requestGenRef = useRef(0);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useLayoutEffect(() => {
        chargedRef.current = charged;
        targetProfileIdRef.current = targetProfileId;
        confirmTargetChangeRef.current = confirmTargetChange;
        commitApprovedTargetRef.current = commitApprovedTarget;
        saveDefaultProfileRef.current = saveDefaultProfile;
        selectionEpochRef.current = selectionEpoch;
    }, [charged, targetProfileId, confirmTargetChange, commitApprovedTarget, saveDefaultProfile, selectionEpoch]);

    // Epoch is the invalidation key: a workspace/batch change drops a save approved for the previous one.
    // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup must run when selectionEpoch changes
    useEffect(
        () => () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        },
        [selectionEpoch],
    );

    const scheduleDefaultSave = useCallback((id: string | null, epoch: string) => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            if (selectionEpochRef.current !== epoch) return;
            saveDefaultProfileRef.current?.(id);
        }, DEFAULT_PROFILE_SAVE_MS);
    }, []);

    const applyTarget = useCallback(
        async (id: string | null, source: 'user' | 'handoff') => {
            if (id === targetProfileIdRef.current) return;
            const gen = ++requestGenRef.current;
            const epoch = selectionEpochRef.current;
            const gate = confirmTargetChangeRef.current;
            if (gate && !(await gate(id))) return;
            if (gen !== requestGenRef.current || selectionEpochRef.current !== epoch) return;
            // Replay stop (and its unsent cancel) before the target the replay plan reads.
            commitApprovedTargetRef.current?.(id);
            userSelectedTargetRef.current = true;
            setTargetProfileId(id);
            if (source === 'user' && !chargedRef.current) scheduleDefaultSave(id, epoch);
        },
        [scheduleDefaultSave],
    );

    // 로그인 후 DB에서 기본 프로파일 ID를 가져와서 targetProfileId에 세팅.
    // charged 상태(로스팅 진행 중)에서는 절대 덮어쓰면 안 됨.
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    useEffect(() => {
        if (chargedRef.current || userSelectedTargetRef.current) return;
        if (userProfile !== undefined) {
            setTargetProfileId(userProfile?.default_roast_profile_id ?? null);
        }
    }, [userProfile?.default_roast_profile_id]);

    // Inventory start-roast: consume pendingBeanId(+name) when roast view activates
    useEffect(() => {
        if (!isActive) return;
        const { pendingBeanId, pendingBeanName, setPendingBean } = useRoastingStore.getState();
        if (!pendingBeanId) return;

        setSelectedBeanId(pendingBeanId);
        setHandoffBeanName(pendingBeanName);
        appliedDefaultBeanRef.current = true;
        setPendingBean(null);
    }, [isActive]);

    // Profiles page "start with this profile" → consume pendingProfileId when roast view activates
    useEffect(() => {
        if (!isActive) return;
        const { pendingProfileId, setPendingProfile } = useRoastingStore.getState();
        if (!pendingProfileId) return;

        setPendingProfile(null);
        void applyTarget(pendingProfileId, 'handoff');
    }, [isActive, applyTarget]);

    // Schedule batch handoff → bean/profile on active roast
    const planBatchHandoff = useRoastSessionStore((s) => s.planBatchHandoff);
    useEffect(() => {
        if (!isActive || !planBatchHandoff) return;
        // Single bean batch: lock bean id. Blend-only: clear single-bean so blend deduction path is used.

        setSelectedBeanId(planBatchHandoff.beanId ?? null);
        setHandoffBeanName(planBatchHandoff.beanName || null);
        appliedDefaultBeanRef.current = true;
        if (planBatchHandoff.profileId) {
            void applyTarget(planBatchHandoff.profileId, 'handoff');
        }
    }, [isActive, planBatchHandoff, applyTarget]);

    // One-time default bean from localStorage if nothing was handed off yet
    useEffect(() => {
        if (!isActive || appliedDefaultBeanRef.current || chargedRef.current) return;
        if (selectedBeanId) {
            appliedDefaultBeanRef.current = true;
            return;
        }
        try {
            const stored = localStorage.getItem(DEFAULT_BEAN_KEY);
            if (stored) {
                setSelectedBeanId(stored);
            }
        } catch (err) {
            logger.capture(err, { scope: 'roastProfileSelection.applyDefaultBean' });
        }
        appliedDefaultBeanRef.current = true;
    }, [isActive, selectedBeanId]);

    // Clear deleted / other-workspace bean ids after beans load successfully (#176).
    // Never clear while loading (empty placeholder) or during schedule/inventory handoff name.
    // A just-created lot can land in selection and the list on different renders (#567).
    useEffect(() => {
        if (!beansReady || !selectedBeanId) return;
        if (handoffBeanName) return;
        if (beans.some((b) => b.id === selectedBeanId)) return;
        const pendingFrom = optimisticReplacementSource(selectedBeanId);
        if (pendingFrom && beans.some((b) => b.id === pendingFrom)) return;
        const pendingTo = optimisticReplacementTarget(selectedBeanId);
        if (pendingTo) {
            setSelectedBeanId(pendingTo);
            return;
        }
        setSelectedBeanId(null);
        try {
            localStorage.removeItem(DEFAULT_BEAN_KEY);
        } catch (err) {
            logger.capture(err, { scope: 'roastProfileSelection.clearDefaultBean' });
            /* ignore */
        }
    }, [beansReady, beans, selectedBeanId, handoffBeanName]);

    const setUserSelectedTarget = useCallback(
        (id: string | null) => {
            void applyTarget(id, 'user');
        },
        [applyTarget],
    );

    const handleSetSelectedBeanId = useCallback((id: string | null) => {
        setSelectedBeanId(id);
        // User override wins over handoff display name; RoastHeader resolves name from beans list.
        if (id) setHandoffBeanName(null);
    }, []);

    return {
        targetProfileId,
        setTargetProfileId,
        selectedBeanId,
        setSelectedBeanId: handleSetSelectedBeanId,
        handoffBeanName,
        setUserSelectedTarget,
    };
};
