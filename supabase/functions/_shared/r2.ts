import { GetObjectCommand, PutObjectCommand, S3Client } from 'npm:@aws-sdk/client-s3@3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';

const PRESIGN_EXPIRY_SEC = 300;
const PROFILE_KEY_RE = /^profiles\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.tsv$/;

export const isValidSessionId = (sessionId: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);

export const profileKeyForUser = (userId: string, sessionId: string): string =>
    `profiles/${userId}/${sessionId}.tsv`;

export const isOwnedProfileKey = (key: string, userId: string): boolean =>
    PROFILE_KEY_RE.test(key) && key.startsWith(`profiles/${userId}/`);

const getR2Client = (): S3Client => {
    const accountId = Deno.env.get('R2_ACCOUNT_ID');
    const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
    const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
    if (!accountId || !accessKeyId || !secretAccessKey) {
        throw new Error('R2 credentials are not configured');
    }
    return new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
    });
};

const getBucket = (): string => {
    const bucket = Deno.env.get('R2_BUCKET_NAME');
    if (!bucket) throw new Error('R2_BUCKET_NAME is not configured');
    return bucket;
};

export const presignUploadUrl = async (userId: string, sessionId: string): Promise<string> => {
    const key = profileKeyForUser(userId, sessionId);
    return getSignedUrl(
        getR2Client(),
        new PutObjectCommand({
            Bucket: getBucket(),
            Key: key,
            ContentType: 'text/tab-separated-values',
        }),
        { expiresIn: PRESIGN_EXPIRY_SEC },
    );
};

export const presignDownloadUrl = async (userId: string, key: string): Promise<string> => {
    if (!isOwnedProfileKey(key, userId)) {
        throw new Error('Forbidden');
    }
    return getSignedUrl(
        getR2Client(),
        new GetObjectCommand({ Bucket: getBucket(), Key: key }),
        { expiresIn: PRESIGN_EXPIRY_SEC },
    );
};
