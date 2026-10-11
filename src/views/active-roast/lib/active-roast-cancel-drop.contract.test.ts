import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const activeRoastSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../ActiveRoast.tsx'), 'utf8');

describe('ActiveRoast cancel/drop wiring contract', () => {
    it('handleCancelDrop delegates machine effects to runCancelDropMachineWiring', () => {
        expect(activeRoastSource).toContain('runCancelDropMachineWiring');
        expect(activeRoastSource).not.toMatch(/handleCancelDrop[\s\S]{0,800}machineControl\.pid\.turnOff/);
    });

    it('applyDrop uses finishDropControlSnapshot with machine wiring', () => {
        expect(activeRoastSource).toContain('finishDropControlSnapshot');
        expect(activeRoastSource).toMatch(/finishDropControlSnapshot\([\s\S]*?wiring\)/);
    });
});
