import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// TODO: VITE_R2_* 자격증명이 client 번들에 노출됨.
// 후속 PR에서 Cloudflare Worker + Supabase JWT 검증 + presigned URL로 이전 예정.
// 영향: roast TSV upload/read 전체.

let client: S3Client | null = null;

const getClient = (): S3Client => {
    if (client) return client;
    client = new S3Client({
        region: 'auto',
        endpoint: `https://${import.meta.env.VITE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: import.meta.env.VITE_R2_ACCESS_KEY_ID,
            secretAccessKey: import.meta.env.VITE_R2_SECRET_ACCESS_KEY,
        },
    });
    return client;
};

export const fetchTsvFromR2 = async (key: string): Promise<string> => {
    const res = await getClient().send(
        new GetObjectCommand({
            Bucket: import.meta.env.VITE_R2_BUCKET_NAME,
            Key: key,
        }),
    );
    if (!res.Body) throw new Error(`Empty body for R2 key: ${key}`);
    return await res.Body.transformToString();
};
