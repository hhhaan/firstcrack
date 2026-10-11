export interface CropsterSettingsSnapshot {
    status: 'found' | 'not-found' | 'needs-app-closed' | 'unsupported' | 'unreadable';
    reason?: string;
    source: { product: 'Cropster'; version: string | null; sourceId: 'default' };
    machine: Record<string, unknown> | null;
    preferences: Record<string, unknown> | null;
}
