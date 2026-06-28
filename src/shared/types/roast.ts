export interface LogEntry {
    id?: string;
    time: string;
    event: string;
    temp: string;
    note: string;
    current?: boolean;
    chartLabel?: string;
    color?: string;
}
