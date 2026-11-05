// Plan-cap parity gate: SQL trigger caps (server authority) vs plan-matrix.ts client constants.
// Parses anchors from the latest migration defining the gate functions; any parse miss is a hard fail.
import { readdirSync, readFileSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';
const PLAN_MATRIX = 'src/shared/lib/features/plan-matrix.ts';

let failed = false;
const fail = (msg) => {
    console.error(`check-plan-caps: ${msg}`);
    process.exit(1);
};

/** Newest migration that DEFINES the function (not just calls it). */
const latestDefining = (fnName) => {
    const re = new RegExp(
        String.raw`CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(?:(?:public|private)\.)?${fnName}\s*\(`,
        'i',
    );
    const file = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .reverse()
        .find((f) => re.test(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8')));
    if (!file) fail(`no migration defines ${fnName}()`);
    return `${MIGRATIONS_DIR}/${file}`;
};

const extract = (file, label, regex) => {
    const m = readFileSync(file, 'utf8').match(regex);
    if (!m) fail(`anchor "${label}" not found in ${file} (pattern: ${regex}) — anchor moved? Update this script.`);
    return Number(m[1]);
};

const usageSql = latestDefining('roast_charge_usage');
const eventSql = latestDefining('reserve_roast_charge');

// SQL side (server authority) — anchors documented in the migration files.
const server = {
    TRIAL_EVENT_DURATION_DAYS: {
        value: extract(eventSql, 'event duration hours', /interval '(\d+) hours'/) / 24,
        file: eventSql,
    },
    TRIAL_EVENT_BATCH_CAP: {
        value: extract(usageSql, 'event Charge cap', /IF plan = 'trial-event' THEN[\s\S]*?batch_cap := (\d+)/),
        file: usageSql,
    },
    PRO_MONTHLY_BATCH_CAP: {
        value: extract(usageSql, 'monthly Charge cap', /THEN batch_cap := (\d+)/),
        file: usageSql,
    },
    TRIAL_DURATION_DAYS: {
        value: extract(usageSql, "interval 'N days'", /interval '(\d+) days'/),
        file: usageSql,
    },
    TRIAL_BATCH_CAP: {
        value: extract(usageSql, 'trial Charge cap', /IF plan = 'trial' THEN\s*batch_cap := (\d+)/),
        file: usageSql,
    },
};

// Client side — `export const NAME = N` in plan-matrix.ts.
const client = Object.fromEntries(
    Object.keys(server).map((name) => [name, extract(PLAN_MATRIX, `${name} = N`, new RegExp(`${name} = (\\d+)`))]),
);

for (const [name, { value, file }] of Object.entries(server)) {
    if (value !== client[name]) {
        failed = true;
        console.error(`${name}: SQL=${value} (${file}) != client=${client[name]} (${PLAN_MATRIX})`);
    }
}

if (failed) {
    console.error('\nPlan caps drifted. SQL is the authority — update plan-matrix.ts (or ship both together).');
    process.exit(1);
}
process.stdout.write(
    `plan-caps: OK (monthly=${client.PRO_MONTHLY_BATCH_CAP}, trial=${client.TRIAL_DURATION_DAYS}d/${client.TRIAL_BATCH_CAP} batches)\n`,
);
