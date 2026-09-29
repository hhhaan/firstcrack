import { i18n } from '@shared/i18n';
import { useToastStore } from '@shared/store/toast';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import en from '../../../shared/i18n/locales/en.json';
import ja from '../../../shared/i18n/locales/ja.json';
import ko from '../../../shared/i18n/locales/ko.json';
import zhCN from '../../../shared/i18n/locales/zh-CN.json';
import {
    beginMachineConnectAttempt,
    captureLinkEpoch,
    endMachineConnectAttempt,
    machineTemperatureQuality,
    noteUserMachineDisconnect,
    observeMachineLink,
    observeRoastLink,
    resetMachineLinkNotice,
    setRoastLinkWatch,
    settleUserMachineDisconnect,
} from './machineLinkNotice';

const clearToasts = () => {
    for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
};

const toastCount = () => useToastStore.getState().toasts.length;

const arm = () => observeRoastLink({ connected: true, reconnecting: false, observation: 'valid' });

beforeAll(async () => {
    if (!i18n.isInitialized) {
        await i18n.init({
            lng: 'en',
            fallbackLng: 'en',
            resources: {
                en: { translation: en },
                ko: { translation: ko },
                ja: { translation: ja },
                'zh-CN': { translation: zhCN },
            },
            interpolation: { escapeValue: false },
        });
    }
});

afterEach(() => {
    clearToasts();
    resetMachineLinkNotice();
    vi.useRealTimers();
});

describe('machine link instability notice', () => {
    it('ships the unstable-link copy in ko, en, ja, and zh-CN', () => {
        expect(ko.machines.linkUnstable).toBe('머신 연결이 불안정합니다. 케이블과 네트워크 상태를 확인해 주세요.');
        expect(en.machines.linkUnstable).toBe('Machine connection is unstable. Check the cable and network.');
        expect(ja.machines.linkUnstable).toBe(
            'マシンの接続が不安定です。ケーブルとネットワークの状態を確認してください。',
        );
        expect(zhCN.machines.linkUnstable).toBe('设备连接不稳定。请检查线缆和网络状态。');
    });

    it('does not notify before a link has been confirmed', () => {
        observeRoastLink({ connected: false, reconnecting: false });
        observeRoastLink({ connected: false, reconnecting: true });
        observeMachineLink({ connected: false, observation: 'poll_error' });
        observeMachineLink({ connected: false, observation: 'null' });
        observeMachineLink({ connected: false, observation: 'stale' });
        expect(toastCount()).toBe(0);
    });

    it('toasts once on auto-reconnect or unintended disconnect after a healthy link', () => {
        arm();
        observeRoastLink({ connected: true, reconnecting: true, observation: 'reconnecting' });
        expect(toastCount()).toBe(1);

        clearToasts();
        observeRoastLink({ connected: false, reconnecting: true });
        observeRoastLink({ connected: false, reconnecting: false });
        expect(toastCount()).toBe(0);
    });

    it('toasts on a hard disconnect and stays quiet while that fault continues', () => {
        arm();
        observeRoastLink({ connected: false, reconnecting: false });
        expect(toastCount()).toBe(1);
        expect(useToastStore.getState().toasts[0]?.message).toBe(en.machines.linkUnstable);
        clearToasts();
        observeRoastLink({ connected: false, reconnecting: false });
        observeMachineLink({ connected: false, reconnecting: true });
        expect(toastCount()).toBe(0);
    });

    it('does not re-fire after the toast auto-dismisses', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        arm();
        observeRoastLink({ connected: false });
        expect(toastCount()).toBe(1);
        vi.advanceTimersByTime(6_000);
        expect(toastCount()).toBe(0);
        observeRoastLink({ connected: false });
        observeRoastLink({ reconnecting: true, connected: false });
        expect(toastCount()).toBe(0);
    });

    it('does not re-fire when the other screen observes the same fault', () => {
        arm();
        observeRoastLink({ connected: false, reconnecting: true });
        expect(toastCount()).toBe(1);
        clearToasts();
        setRoastLinkWatch(false);
        observeMachineLink({ connected: false, reconnecting: true, observation: 'poll_error' });
        expect(toastCount()).toBe(0);
    });

    it('notifies again only after a connected valid temperature', () => {
        arm();
        observeRoastLink({ connected: false });
        clearToasts();
        observeRoastLink({ connected: true, reconnecting: false });
        observeRoastLink({ connected: false });
        expect(toastCount()).toBe(0);

        observeRoastLink({ connected: true, reconnecting: false, observation: 'valid' });
        observeRoastLink({ connected: false });
        expect(toastCount()).toBe(1);
    });

    it('re-arms on a repeated non-stale temperature and not on stale or status alone', () => {
        arm();
        observeRoastLink({ connected: true, observation: 'poll_error' });
        observeRoastLink({ connected: true, observation: 'poll_error' });
        observeRoastLink({ connected: true, observation: 'poll_error' });
        expect(toastCount()).toBe(1);
        clearToasts();

        observeRoastLink({ connected: true, reconnecting: false, observation: 'stale' });
        observeRoastLink({ connected: true, observation: 'poll_error' });
        observeRoastLink({ connected: true, observation: 'poll_error' });
        observeRoastLink({ connected: true, observation: 'poll_error' });
        expect(toastCount()).toBe(0);

        observeRoastLink({ connected: true, reconnecting: false, observation: 'retransmit' });
        observeRoastLink({ connected: true, observation: 'poll_error' });
        observeRoastLink({ connected: true, observation: 'poll_error' });
        expect(toastCount()).toBe(0);
        observeRoastLink({ connected: true, observation: 'null' });
        expect(toastCount()).toBe(1);
    });

    it('lets a machines-page temperature re-arm while roast polling owns the streak', () => {
        arm();
        setRoastLinkWatch(true);
        observeRoastLink({ connected: true, observation: 'poll_error' });
        observeRoastLink({ connected: true, observation: 'stale' });
        observeRoastLink({ connected: true, observation: 'null' });
        expect(toastCount()).toBe(1);
        clearToasts();

        observeMachineLink({ connected: true, reconnecting: false, observation: 'poll_error' });
        expect(toastCount()).toBe(0);
        observeMachineLink({ connected: true, reconnecting: false, observation: 'valid' });
        observeRoastLink({ connected: true, observation: 'poll_error' });
        observeRoastLink({ connected: true, observation: 'poll_error' });
        expect(toastCount()).toBe(0);
        observeRoastLink({ connected: true, observation: 'null' });
        expect(toastCount()).toBe(1);
    });

    it('starts the streak from a connected status without a prior temperature', () => {
        observeMachineLink({ connected: true, observation: 'null' });
        observeMachineLink({ connected: true, observation: 'null' });
        expect(toastCount()).toBe(0);
        observeMachineLink({ connected: true, observation: 'null' });
        expect(toastCount()).toBe(1);
    });

    it('counts three consecutive communication faults and ignores a single failure', () => {
        arm();
        observeRoastLink({ connected: true, observation: 'poll_error' });
        expect(toastCount()).toBe(0);
        observeRoastLink({ connected: true, observation: 'stale' });
        expect(toastCount()).toBe(0);
        observeRoastLink({ connected: true, observation: 'null' });
        expect(toastCount()).toBe(1);
        clearToasts();
        observeRoastLink({ connected: true, observation: 'null' });
        observeRoastLink({ connected: true, observation: 'stale' });
        expect(toastCount()).toBe(0);
    });

    it('does not treat temperature spikes or retransmits as communication faults', () => {
        arm();
        observeRoastLink({ connected: true, observation: 'spike' });
        observeRoastLink({ connected: true, observation: 'spike' });
        observeRoastLink({ connected: true, observation: 'spike' });
        expect(toastCount()).toBe(0);

        observeRoastLink({ connected: true, observation: 'poll_error' });
        observeRoastLink({ connected: true, observation: 'poll_error' });
        observeRoastLink({ connected: true, observation: 'spike' });
        observeRoastLink({ connected: true, observation: 'retransmit' });
        observeRoastLink({ connected: true, observation: 'null' });
        expect(toastCount()).toBe(0);
    });

    it('ignores a connect attempt and a user disconnect', () => {
        arm();
        const inflight = captureLinkEpoch();
        beginMachineConnectAttempt();
        observeRoastLink({ connected: false }, inflight);
        observeRoastLink({ connected: false });
        endMachineConnectAttempt(false);
        observeRoastLink({ connected: false });
        expect(toastCount()).toBe(0);

        arm();
        const poll = captureLinkEpoch();
        noteUserMachineDisconnect();
        observeRoastLink({ connected: true, observation: 'valid' }, poll);
        observeMachineLink({ connected: false });
        expect(toastCount()).toBe(0);
    });

    it('does not re-arm from a poll that overlapped an explicit disconnect', () => {
        arm();
        noteUserMachineDisconnect();
        const overlapped = captureLinkEpoch();
        settleUserMachineDisconnect(true);
        observeRoastLink({ connected: true, observation: 'valid' }, overlapped);
        observeRoastLink({ connected: true, observation: 'valid' });
        observeRoastLink({ connected: false });
        expect(toastCount()).toBe(0);

        observeRoastLink({ connected: true, observation: 'valid' });
        observeRoastLink({ connected: false });
        expect(toastCount()).toBe(1);
    });

    it('counts machines-page temperature failures while the roast watch flag is still set', () => {
        arm();
        setRoastLinkWatch(true);
        observeMachineLink({ connected: true, observation: 'poll_error' });
        observeMachineLink({ connected: true, observation: 'stale' });
        expect(toastCount()).toBe(0);
        observeMachineLink({ connected: true, observation: 'null' });
        expect(toastCount()).toBe(1);
        clearToasts();
        observeMachineLink({ connected: true, observation: 'poll_error' });
        observeRoastLink({ connected: true, observation: 'poll_error' });
        expect(toastCount()).toBe(0);
    });

    it('does not let a machines-page spike open or reset the streak during roast watch', () => {
        arm();
        setRoastLinkWatch(true);
        observeMachineLink({ connected: true, observation: 'spike' });
        observeMachineLink({ connected: true, observation: 'spike' });
        observeMachineLink({ connected: true, observation: 'spike' });
        expect(toastCount()).toBe(0);
        observeMachineLink({ connected: true, observation: 'poll_error' });
        observeMachineLink({ connected: true, observation: 'poll_error' });
        observeMachineLink({ connected: true, observation: 'null' });
        expect(toastCount()).toBe(1);
    });

    it('maps machine temperatures without treating a numeric spike as a comm fault', () => {
        expect(machineTemperatureQuality(null)).toBe('poll_error');
        expect(machineTemperatureQuality({ bt: null, stale: true })).toBe('null');
        expect(machineTemperatureQuality({ bt: 200, stale: true })).toBe('stale');
        expect(machineTemperatureQuality({ bt: 200, reconnecting: true })).toBe('reconnecting');
        expect(machineTemperatureQuality({ bt: 1372 })).toBe('valid');
    });
});
