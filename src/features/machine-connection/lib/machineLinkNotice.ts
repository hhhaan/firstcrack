import { i18n } from '@shared/i18n';
import { createBtFilter } from '@shared/lib/btFilter';
import { useToastStore } from '@shared/store/toast';

/**
 * In-app notice when a link that was already up becomes unstable.
 * Toast dedupe only lasts while the toast is visible — `faultOpen` suppresses
 * repeats across dismiss, poll retries, reconnect attempts, and screen changes.
 * Cleared only after a connected sample with a non-stale temperature.
 * A repeated device clock (`retransmit`) is still a received temperature.
 */

export const LINK_FAULT_THRESHOLD = 3;

export type LinkReadingQuality = 'valid' | 'stale' | 'retransmit' | 'null' | 'spike' | 'poll_error' | 'reconnecting';

export type LinkSample = {
    connected?: boolean;
    reconnecting?: boolean;
    observation?: LinkReadingQuality;
    bt?: number | null;
};

type LinkState = {
    confirmed: boolean;
    faultOpen: boolean;
    consecutive: number;
    connectAttempt: boolean;
};

const COMM_FAULT: ReadonlySet<LinkReadingQuality> = new Set(['stale', 'null', 'poll_error']);

const fresh = (): LinkState => ({
    confirmed: false,
    faultOpen: false,
    consecutive: 0,
    connectAttempt: false,
});

let link = fresh();
let filterBt = createBtFilter();
let roastWatch = false;
/** Bumped on user disconnect / connect attempt so in-flight polls cannot re-arm. */
let linkGeneration = 0;
/** After an explicit disconnect, ignore connected samples until one reports disconnected. */
let ignoreConnected = false;

export const captureLinkEpoch = (): number => linkGeneration;

const staleEpoch = (epoch?: number) => epoch != null && epoch < linkGeneration;

const bumpGeneration = () => {
    linkGeneration += 1;
};

export const resetMachineLinkNotice = (): void => {
    link = fresh();
    filterBt = createBtFilter();
    roastWatch = false;
    linkGeneration = 0;
    ignoreConnected = false;
};

/** Live-roast temperature polling is the spike-aware source. Machine polls must not double-count. */
export const setRoastLinkWatch = (active: boolean): void => {
    roastWatch = active;
};

export const noteUserMachineDisconnect = (): void => {
    bumpGeneration();
    link = fresh();
    filterBt = createBtFilter();
    ignoreConnected = true;
};

/** Call after the disconnect request settles. Drops polls that started during it. */
export const settleUserMachineDisconnect = (released: boolean): void => {
    bumpGeneration();
    if (!released) ignoreConnected = false;
};

export const beginMachineConnectAttempt = (): void => {
    bumpGeneration();
    filterBt = createBtFilter();
    ignoreConnected = false;
    link = { ...link, connectAttempt: true };
};

export const endMachineConnectAttempt = (connected: boolean): void => {
    bumpGeneration();
    ignoreConnected = false;
    link = {
        ...link,
        connectAttempt: false,
        ...(connected ? {} : { confirmed: false, faultOpen: false, consecutive: 0 }),
    };
};

const notify = () => {
    useToastStore.getState().show(i18n.t('machines.linkUnstable'), 'error');
};

const isReconnecting = (sample: LinkSample) => Boolean(sample.reconnecting) || sample.observation === 'reconnecting';

/** Connected and a received non-stale temperature. Status alone does not recover. */
const temperatureRecovered = (sample: LinkSample) =>
    sample.connected === true &&
    !isReconnecting(sample) &&
    (sample.observation === 'valid' || sample.observation === 'retransmit');

const reduceLinkSample = (state: LinkState, sample: LinkSample): { state: LinkState; notify: boolean } => {
    if (state.connectAttempt) return { state, notify: false };

    const reconnecting = isReconnecting(sample);

    if (temperatureRecovered(sample)) {
        return {
            state: { ...state, confirmed: true, faultOpen: false, consecutive: 0 },
            notify: false,
        };
    }

    let current = state;
    if (!current.confirmed) {
        if (sample.connected !== true || reconnecting) return { state: current, notify: false };
        current = { ...current, confirmed: true };
        if (!sample.observation || !COMM_FAULT.has(sample.observation)) {
            return { state: current, notify: false };
        }
    }

    if (reconnecting || sample.connected === false) {
        if (current.faultOpen) return { state: { ...current, consecutive: 0 }, notify: false };
        return { state: { ...current, faultOpen: true, consecutive: 0 }, notify: true };
    }

    if (sample.observation && COMM_FAULT.has(sample.observation)) {
        const consecutive = current.consecutive + 1;
        const open = consecutive >= LINK_FAULT_THRESHOLD && !current.faultOpen;
        return {
            state: { ...current, consecutive, faultOpen: current.faultOpen || open },
            notify: open,
        };
    }

    // Spike / retransmit: communication worked. Breaks a streak, does not recover a fault.
    if (
        sample.observation &&
        (sample.observation === 'spike' || sample.observation === 'retransmit' || sample.observation === 'valid') &&
        !current.faultOpen
    ) {
        return { state: { ...current, consecutive: 0 }, notify: false };
    }

    return { state: current, notify: false };
};

const commit = (sample: LinkSample) => {
    if (ignoreConnected) {
        if (sample.connected !== false) return;
        ignoreConnected = false;
    }
    const result = reduceLinkSample(link, sample);
    link = result.state;
    if (result.notify) notify();
};

export const observeRoastLink = (sample: LinkSample, epoch?: number): void => {
    if (staleEpoch(epoch)) return;
    // Roast readings are already filtered; preserve their baseline across screen changes.
    if (!link.connectAttempt && !ignoreConnected && temperatureRecovered(sample) && sample.bt != null) {
        filterBt = createBtFilter();
        filterBt(sample.bt, Date.now());
    }
    commit(sample);
};

export const observeMachineLink = (sample: LinkSample, epoch?: number): void => {
    if (staleEpoch(epoch)) return;
    const reading =
        !link.connectAttempt &&
        !ignoreConnected &&
        temperatureRecovered(sample) &&
        sample.bt != null &&
        filterBt(sample.bt, Date.now()) === null
            ? { ...sample, observation: 'spike' as const }
            : sample;
    // Roast polling owns fault streaks. A machines-page temperature can still re-arm.
    if (roastWatch && !temperatureRecovered(reading)) return;
    commit(reading);
};

/**
 * Link-notice quality. Unlike `sensorObservation`, a non-stale BT is `valid`
 * even when the device clock did not advance.
 */
export const machineTemperatureQuality = (
    temps: { bt: number | null; stale?: boolean; reconnecting?: boolean; spike?: boolean; pollError?: boolean } | null,
): LinkReadingQuality => {
    if (!temps || temps.pollError) return 'poll_error';
    if (temps.reconnecting) return 'reconnecting';
    if (temps.spike) return 'spike';
    if (temps.bt == null) return 'null';
    if (temps.stale) return 'stale';
    return 'valid';
};
