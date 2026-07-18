import { DEFAULT_BEAN_KEY } from '@features/active-roast/lib/constants';
import { useRoastingStore } from '@features/active-roast/model/status';
import { useRoastSessionStore } from '@shared/store/roastSession';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UserProfile {
    default_roast_profile_id?: string | null;
}

export interface UseRoastProfileSelectionParams {
    isActive: boolean;
    charged: boolean;
    userProfile: UserProfile | null | undefined;
}

export interface UseRoastProfileSelectionReturn {
    targetProfileId: string | null;
    setTargetProfileId: (id: string | null) => void;
    selectedBeanId: string | null;
    setSelectedBeanId: (id: string | null) => void;
    handoffBeanName: string | null;
    setUserSelectedTarget: (id: string | null) => void;
}

export const useRoastProfileSelection = (params: UseRoastProfileSelectionParams): UseRoastProfileSelectionReturn => {
    const { isActive, charged, userProfile } = params;

    const [targetProfileId, setTargetProfileId] = useState<string | null>(null);
    const userSelectedTargetRef = useRef(false);
    const [selectedBeanId, setSelectedBeanId] = useState<string | null>(() => {
        try {
            return localStorage.getItem(DEFAULT_BEAN_KEY);
        } catch {
            return null;
        }
    });
    const [handoffBeanName, setHandoffBeanName] = useState<string | null>(null);
    const appliedDefaultBeanRef = useRef(Boolean(selectedBeanId));

    const chargedRef = useRef(charged);
    // eslint-disable-next-line react-hooks/refs
    chargedRef.current = charged;

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

    // Schedule batch handoff → bean/profile on active roast
    const planBatchHandoff = useRoastSessionStore((s) => s.planBatchHandoff);
    useEffect(() => {
        if (!isActive || !planBatchHandoff) return;
        // Single bean batch: lock bean id. Blend-only: clear single-bean so blend deduction path is used.

        setSelectedBeanId(planBatchHandoff.beanId ?? null);
        setHandoffBeanName(planBatchHandoff.beanName || null);
        appliedDefaultBeanRef.current = true;
        if (planBatchHandoff.profileId) {
            userSelectedTargetRef.current = true;

            setTargetProfileId(planBatchHandoff.profileId);
        }
    }, [isActive, planBatchHandoff]);

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
        } catch {
            /* ignore */
        }
        appliedDefaultBeanRef.current = true;
    }, [isActive, selectedBeanId]);

    const setUserSelectedTarget = useCallback((id: string | null) => {
        userSelectedTargetRef.current = true;
        setTargetProfileId(id);
    }, []);

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
