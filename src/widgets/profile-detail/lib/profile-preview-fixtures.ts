import type { ProfileReferenceBatch, RoastProfileWithSource } from '@entities/roast-profile';

export const profilePreviewBatches: ProfileReferenceBatch[] = [
    {
        id: 's4',
        roasted_at: '2026-10-22T01:00:00Z',
        batch_name: 'ZIPPER 4',
        bean_label: null,
        profile_batch_number: 4,
        total_batch_number: 40,
        tsv_path: 'curves/s4.tsv',
        bbp_tsv_path: null,
        bbp_seconds: null,
        beans: null,
        blends: null,
    },
    {
        id: 's3',
        roasted_at: '2026-10-18T01:00:00Z',
        batch_name: 'ZIPPER 3',
        bean_label: null,
        profile_batch_number: 3,
        total_batch_number: 31,
        tsv_path: 'curves/s3.tsv',
        bbp_tsv_path: null,
        bbp_seconds: null,
        beans: null,
        blends: null,
    },
];

export const profilePreviewOrphanSource = {
    id: 'p1',
    user_id: 'owner',
    name: 'New ZIPPER',
    source_session_id: 'picked-session',
    source_session: { tsv_path: 'curves/picked.tsv', events: null, duration_seconds: 540 },
    duration_sec: 600,
} as RoastProfileWithSource;

export const profilePreviewReference = {
    id: 'p1',
    user_id: 'owner',
    name: 'ZIPPER',
    source_session_id: 's3',
    source_session: { tsv_path: 'curves/s3.tsv', events: null },
    duration_sec: 600,
} as RoastProfileWithSource;

export const profilePreviewMiniTsv = () =>
    'time\tbt\tet\tror\theater\tfan\tdrum\theater_set\tet_raw\tbt_raw\tror_et\tsensor_timestamp\tsensor_clock\textra_readings\n0\t150\t180\t0\t0\t0\t0\t0\t\t\t0\t\t\t\n30\t200\t210\t10\t0\t0\t0\t0\t\t\t0\t\t\t\n';
