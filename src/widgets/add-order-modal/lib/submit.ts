const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createManualOrderPlatformId(createId: () => string = () => crypto.randomUUID()): string {
    return createId();
}

export function isManualOrderPlatformId(id: string): boolean {
    return UUID_RE.test(id);
}

export function canSubmitManualOrder(input: { valid: boolean; isPending: boolean }): boolean {
    return input.valid && !input.isPending;
}
