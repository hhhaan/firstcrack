const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_WEBHOOK_URL');

export type SlackPayload = {
    text: string;
    blocks?: unknown[];
};

/** Post a message to the shared service Slack channel (#general). */
export async function postSlack(payload: SlackPayload): Promise<boolean> {
    if (!SLACK_WEBHOOK_URL) {
        console.error('[slack] SLACK_WEBHOOK_URL not set');
        return false;
    }

    try {
        const res = await fetch(SLACK_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
            console.error('[slack] webhook failed', res.status);
            return false;
        }

        return true;
    } catch (err) {
        console.error('[slack] request failed', err);
        return false;
    }
}
