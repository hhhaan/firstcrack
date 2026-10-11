import { describe, expect, it } from 'vitest';
import { createDoorGate } from './doorGate';

describe('createDoorGate', () => {
    it('holds one command and does not remember a rejected one', () => {
        const gate = createDoorGate();
        expect(gate.tryBegin()).toBe(true);
        expect(gate.tryBegin()).toBe(false);
        gate.end();
        expect(gate.tryBegin()).toBe(true);
    });
});
