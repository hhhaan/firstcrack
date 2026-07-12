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
    const [selectedBeanId, setSelectedBeanId] = useState<string | null>(null);
    const [handoffBeanName, setHandoffBeanName] = useState<string | null>(null);

    const chargedRef = useRef(charged);
    // eslint-disable-next-line react-hooks/refs
    chargedRef.current = charged;

    // 로그인 후 DB에서 기본 프로파일 ID를 가져와서 targetProfileId에 세팅.
    // charged 상태(로스팅 진행 중)에서는 절대 덮어쓰면 안 됨.
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    useEffect(() => {
        if (chargedRef.current || userSelectedTargetRef.current) return;
        if (userProfile !== undefined) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setTargetProfileId(userProfile?.default_roast_profile_id ?? null);
        }
    }, [userProfile?.default_roast_profile_id]);

    // isActive가 true가 될 때마다 store의 pendingBeanId를 소비
    useEffect(() => {
        if (!isActive) return;
        const { pendingBeanId, setPendingBean } = useRoastingStore.getState();
        if (pendingBeanId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedBeanId(pendingBeanId);
            setPendingBean(null);
        }
    }, [isActive]);

    // planBatchHandoff가 설정되고 로스트 화면이 활성화될 때 bean/profile 적용
    const planBatchHandoff = useRoastSessionStore((s) => s.planBatchHandoff);
    useEffect(() => {
        if (!isActive || !planBatchHandoff) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (planBatchHandoff.beanId) setSelectedBeanId(planBatchHandoff.beanId);
        setHandoffBeanName(planBatchHandoff.beanName || null);
        if (planBatchHandoff.profileId) {
            userSelectedTargetRef.current = true;
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setTargetProfileId(planBatchHandoff.profileId);
        }
    }, [isActive, planBatchHandoff]);

    const setUserSelectedTarget = useCallback((id: string | null) => {
        userSelectedTargetRef.current = true;
        setTargetProfileId(id);
    }, []);

    return {
        targetProfileId,
        setTargetProfileId,
        selectedBeanId,
        setSelectedBeanId,
        handoffBeanName,
        setUserSelectedTarget,
    };
};
