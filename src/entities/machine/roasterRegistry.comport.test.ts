import { describe, expect, it } from 'vitest';
import { PROTOCOL_FORM_FIELDS } from './roasterRegistry';

describe('roasterRegistry serial comport (#771-7)', () => {
    it('requires comport on modbus protocol form', () => {
        const modbus = PROTOCOL_FORM_FIELDS.modbus ?? [];
        const comport = modbus.find((field) => field.key === 'comport');
        expect(comport?.required).toBe(true);
    });

    it('keeps comport optional on kaleido shared serial fields', () => {
        const kaleido = PROTOCOL_FORM_FIELDS.kaleido ?? [];
        const comport = kaleido.find((field) => field.key === 'comport');
        expect(comport?.required).toBe(false);
    });
});
