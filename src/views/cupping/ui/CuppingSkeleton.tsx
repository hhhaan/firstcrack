import { TableSkeleton } from '@shared/ui/TableSkeleton';

const eventCols = [
    { width: '32%', bar: '55%' },
    { width: '14%', bar: '70%' },
    { width: '12%', bar: '40%' },
    { width: '12%', bar: '45%' },
    { width: '14%', bar: 64, height: 18, borderRadius: '9999px' },
    { width: '48px', bar: 28, height: 28, borderRadius: '9999px' },
];

const sampleCols = [
    { width: '48px', bar: '60%' },
    { width: '16%', bar: '70%' },
    { width: '24%', bar: '80%' },
    { width: '14%', bar: '55%' },
    { width: '10%', bar: '40%' },
    { width: '10%', bar: '50%' },
    { width: '48px', bar: 28, height: 28, borderRadius: '9999px' },
];

export const CuppingEventListSkeleton = () => <TableSkeleton cols={eventCols} rows={6} />;

export const CuppingSampleListSkeleton = () => <TableSkeleton cols={sampleCols} rows={5} minWidth="640px" />;
