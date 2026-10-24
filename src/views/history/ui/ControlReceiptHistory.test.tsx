// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ControlReceiptHistory } from './ControlReceiptHistory';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('shows an unavailable journal once after reopening saved JSON', () => {
    const event = {
        id: 'receipt-gap',
        type: 'Control',
        time_sec: 22,
        control_receipt: { kind: 'gap', session_id: 'session', charge_id: 'charge', from: 1, through: 4 },
    };
    const html = renderToStaticMarkup(<ControlReceiptHistory events={JSON.parse(JSON.stringify([event, event]))} />);
    expect(html.match(/history.receipts.gap/g)).toHaveLength(1);
    expect(html).not.toContain('<button');
});
