/** Session heat-curve edits at Drop — same shape as machine-control `ReplayEvent`. */
export type ReplayBatchEventSnapshot = {
    id?: string;
    t: number;
    bt: number;
    heater: number;
    trigger?: 'time' | 'bt';
};
