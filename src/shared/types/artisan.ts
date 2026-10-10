export interface ArtisanSettingsSnapshot {
    status: 'found' | 'not-found' | 'needs-app-closed' | 'unsupported' | 'unreadable';
    reason?: string;
    source: { product: 'Artisan'; version: string | null; sourceId: 'native' };
    settings: Record<string, unknown> | null;
}
