export interface FirescopeSettingsSnapshot {
    status: 'found' | 'not-found' | 'needs-app-closed' | 'unsupported' | 'unreadable';
    reason?: string;
    source: { product: 'Firescope'; version: string | null };
    graphTemperatureUnit: string | null;
    graph: Record<string, unknown> | null;
    indicator: Record<string, unknown> | null;
    global: Record<string, unknown> | null;
    machines: { sequence: number; current: boolean; settings: Record<string, unknown> }[];
}
