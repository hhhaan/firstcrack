// @vitest-environment jsdom
import { initRoasterFormParams, ROASTER_REGISTRY } from '@entities/machine';
import { openUrl } from '@tauri-apps/plugin-opener';
import { platform } from '@tauri-apps/plugin-os';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { DriverSettingsSection } from './DriverSettingsSection';

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => vi.clearAllMocks());

it.each([
    { name: 'macOS BT 1048', mac: true, bt: '1048', et: 'TMP1101', channelEt: '1', showHid: true },
    { name: 'Windows 1048', mac: false, bt: '1048', et: '1048', channelEt: '1', showHid: false },
    { name: 'macOS VINT', mac: true, bt: 'TMP1101', et: 'TMP1101', channelEt: '1', showHid: false },
    { name: 'macOS active ET 1048 channel 0', mac: true, bt: 'TMP1101', et: '1048', channelEt: '0', showHid: true },
    { name: 'macOS disabled ET 1048', mac: true, bt: 'TMP1101', et: '1048', channelEt: '', showHid: false },
    { name: 'macOS blank ET channel', mac: true, bt: 'TMP1101', et: '1048', channelEt: ' ', showHid: false },
])('shows relevant setup guidance and opens the OS guide: $name', async ({ mac, bt, et, channelEt, showHid }) => {
    vi.mocked(platform).mockReturnValue(mac ? 'macos' : 'windows');
    const container = document.createElement('div');
    const root = createRoot(container);
    const selectedDef = ROASTER_REGISTRY.phidget_tmp1101;
    try {
        await act(async () =>
            root.render(
                createElement(DriverSettingsSection, {
                    selectedDef,
                    isCustom: false,
                    params: {
                        ...initRoasterFormParams(selectedDef),
                        bt_device_type: bt,
                        et_device_type: et,
                        channel_et: channelEt,
                    },
                    setParam: vi.fn(),
                    serialPorts: [],
                    networkHosts: [],
                    scanningNetwork: false,
                    scannedNetworkOnce: false,
                    showAddressMap: false,
                    addressFields: [],
                }),
            ),
        );
        expect(container.textContent).toContain('addMachine.phidgetDriverNotice');
        expect(container.textContent).toContain('addMachine.phidgetControlPanelHint');
        expect(container.textContent?.includes('addMachine.phidgetMacHidHint')).toBe(showHid);
        const guide = Array.from(container.querySelectorAll('button')).find(
            (button) => button.textContent === 'addMachine.phidgetDriverLink',
        );
        await act(async () => guide?.click());
        expect(openUrl).toHaveBeenCalledWith(`https://www.phidgets.com/docs/OS_-_${mac ? 'macOS' : 'Windows'}`);
    } finally {
        await act(async () => root.unmount());
    }
});
