import type { Machine } from '@entities/machine';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MachineConnectionDetails } from './MachineConnectionDetails';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('shows canonical Phidget identity in the summary and hides disabled ET and inapplicable probe settings', () => {
    const machine: Machine = {
        id: 'phidget',
        name: 'Probes',
        displayName: 'Phidget',
        roasterKey: 'phidget_tmp1200',
        brand: 'Phidget',
        models: ['TMP1200'],
        pid: null,
        protocol: 'phidget',
        capabilities: [],
        createdAt: '2026-11-09T00:00:00Z',
        connectionParams: {
            bt_device_type: 'TMP1200',
            bt_serial_number: 123,
            channel_bt: 0,
            bt_rtd_type: 'PT100_3850',
            bt_rtd_wire_setup: 3,
            bt_thermocouple_type: 'J',
            channel_et: null,
            et_device_type: '1048',
            et_serial_number: 456,
            et_hub_port: 2,
            et_thermocouple_type: 'T',
        },
    };
    const html = renderToStaticMarkup(createElement(MachineConnectionDetails, { machine }));
    const summary = html.split('<details')[0];
    expect(summary).toContain('BT Model');
    expect(summary).toContain('TMP1200');
    expect(summary).toContain('123');
    expect(html).toContain('BT RTD Type');
    expect(html).not.toContain('Thermocouple Type');
    expect(html).not.toContain('ET ');
    expect(html).not.toContain('456');
});
