export interface RoastPoint {
    time: number;
    label: string;
    bt: number;
    et: number;
    ror: number;
}


export interface LogEntry {
    time: string;
    event: string;
    temp: string;
    note: string;
    current?: boolean;
    chartLabel?: string;
    color?: string;
}

export interface ChartDataPoint {
    label: string;
    btActual: number | null;
    etActual: number | null;
    rorActual: number | null;
    btTarget: number | null;
}
