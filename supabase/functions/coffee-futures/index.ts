const SYMBOL = 'KC=F';
const YAHOO_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/' + SYMBOL + '?interval=1d&range=2d';
const CACHE_MAX_AGE = 300;
const TTL_MS = 5 * 60 * 1000;

type FuturesBody = { price: number; previousClose: number };

let cached: { body: FuturesBody; at: number } | null = null;

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            ...cors,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=' + CACHE_MAX_AGE,
        },
    });

Deno.serve(async (_req: Request) => {
    if (_req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    if (cached && Date.now() - cached.at < TTL_MS) {
        return json(cached.body);
    }

    try {
        const res = await fetch(YAHOO_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
        });
        if (!res.ok) return json({ error: 'upstream ' + res.status }, 502);

        const yj = await res.json();
        const meta = yj.chart?.result?.[0]?.meta;
        if (!meta) return json({ error: 'no data' }, 502);

        const previousClose = meta.chartPreviousClose;
        const price = meta.regularMarketPrice;
        if (price == null || previousClose == null) return json({ error: 'incomplete data' }, 502);

        const body: FuturesBody = { price, previousClose };
        cached = { body, at: Date.now() };
        return json(body);
    } catch {
        return json({ error: 'fetch failed' }, 502);
    }
});
