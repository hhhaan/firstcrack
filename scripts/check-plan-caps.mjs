// Plan-cap parity gate: SQL authority vs plan-matrix.ts client defaults.
// Any missing/changed anchor fails closed; per-user event overrides are not plan-default drift.
import { readdirSync, readFileSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';
const PLAN_MATRIX = 'src/shared/lib/features/plan-matrix.ts';
const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .reverse();

let failed = false;
const fail = (msg) => {
    console.error(`check-plan-caps: ${msg}`);
    process.exit(1);
};
const sql = (file) => readFileSync(file, 'utf8').replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '');
const definition = (fnName) =>
    new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(?:public|private)\.)?${fnName}\s*\(`, 'i');

/** Newest migration that DEFINES the function (not just calls it). */
const latestDefining = (fnName) => {
    const file = migrations.find((name) => definition(fnName).test(sql(`${MIGRATIONS_DIR}/${name}`)));
    if (!file) fail(`no migration defines ${fnName}()`);
    return `${MIGRATIONS_DIR}/${file}`;
};

const matchAnchor = (source, file, label, regex) => {
    const match = source.match(regex);
    if (!match) fail(`anchor "${label}" not found in ${file} (pattern: ${regex}) — anchor moved? Update this script.`);
    return match;
};
const extract = (source, file, label, regex) => Number(matchAnchor(source, file, label, regex)[1]);

/** Never borrow an anchor from another function in the same migration. */
const functionBody = (file, fnName) => {
    const source = sql(file);
    const declaration = matchAnchor(source, file, fnName, definition(fnName));
    const remainder = source.slice(declaration.index + declaration[0].length);
    const nextFunction = remainder.search(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i);
    const scope = nextFunction < 0 ? remainder : remainder.slice(0, nextFunction);
    return matchAnchor(scope, file, `${fnName} body`, /\bAS\s+(\$\w*\$)([\s\S]*?)\1/i)[2];
};

/** Only the straight-line prefix of this branch, before ANY nested/alternate branch. */
const branchPrefix = (body, file, plan) => {
    const start = matchAnchor(
        body,
        file,
        `${plan} branch`,
        new RegExp(`\\bIF\\s+plan\\s*=\\s*'${plan}'\\s+THEN\\b`, 'i'),
    );
    const remainder = body.slice(start.index + start[0].length);
    const boundary = remainder.search(/\b(?:IF|ELSIF|ELSE|END)\b/i);
    if (boundary < 0) fail(`anchor "${plan} branch boundary" not found in ${file}`);
    return remainder.slice(0, boundary);
};

/** Read the newest cap-column operation, including SET/DROP DEFAULT. No stale-default fallback. */
const eventColumnDefault = () => {
    for (const name of migrations) {
        const file = `${MIGRATIONS_DIR}/${name}`;
        const statements = [
            ...sql(file).matchAll(/\bALTER\s+TABLE\s+(?:ONLY\s+)?public\.trial_event_grants\s+([^;]+);/gi),
        ];
        for (const [, operation] of statements.reverse()) {
            if (
                !/\b(?:ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?|ALTER\s+(?:COLUMN\s+)?|DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?)batch_cap\b/i.test(
                    operation,
                )
            )
                continue;
            const match = matchAnchor(
                operation.trim(),
                file,
                'event cap column default',
                /^(?:ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?batch_cap\s+integer\s+NOT\s+NULL\s+DEFAULT|ALTER\s+(?:COLUMN\s+)?batch_cap\s+SET\s+DEFAULT)\s+(\d+)\s*$/i,
            );
            return { value: Number(match[1]), file };
        }
    }
    fail('anchor "event cap column default" not found in migrations');
};

const usageSql = latestDefining('roast_charge_usage');
const eventSql = latestDefining('reserve_roast_charge');
const usage = functionBody(usageSql, 'roast_charge_usage');
const eventBranch = branchPrefix(usage, usageSql, 'trial-event');
const trialBranch = branchPrefix(usage, usageSql, 'trial');

const server = [
    {
        name: 'TRIAL_EVENT_DURATION_DAYS',
        value:
            extract(
                sql(eventSql),
                eventSql,
                'event duration hours',
                /CHECK\s*\(\s*ends_at\s*=\s*started_at\s*\+\s*interval\s+'(\d+) hours'\s*\)/i,
            ) / 24,
        file: eventSql,
    },
    { name: 'TRIAL_EVENT_BATCH_CAP', anchor: 'column default', ...eventColumnDefault() },
    {
        name: 'TRIAL_EVENT_BATCH_CAP',
        anchor: 'usage fallback',
        value: extract(
            eventBranch,
            usageSql,
            'event Charge cap fallback',
            /\bbatch_cap\s*:=\s*coalesce\(\s*g\.batch_cap\s*,\s*(\d+)\s*\)\s*;/i,
        ),
        file: usageSql,
    },
    {
        name: 'PRO_MONTHLY_BATCH_CAP',
        value: extract(
            usage,
            usageSql,
            'monthly Charge cap',
            /\bIF\s+plan\s+NOT\s+IN\s*\(\s*'pro_plus'\s*,\s*'tester'\s*,\s*'enterprise'\s*,\s*'team'\s*\)\s+THEN\s+batch_cap\s*:=\s*(\d+)\s*;/i,
        ),
        file: usageSql,
    },
    {
        name: 'TRIAL_DURATION_DAYS',
        value: extract(
            trialBranch,
            usageSql,
            'trial duration days',
            /\bperiod_end\s*:=\s*v_created\s*\+\s*interval\s+'(\d+) days'\s*;/i,
        ),
        file: usageSql,
    },
    {
        name: 'TRIAL_BATCH_CAP',
        value: extract(trialBranch, usageSql, 'trial Charge cap', /\bbatch_cap\s*:=\s*(\d+)\s*;/i),
        file: usageSql,
    },
];

const clientSource = readFileSync(PLAN_MATRIX, 'utf8');
const client = Object.fromEntries(
    [...new Set(server.map(({ name }) => name))].map((name) => [
        name,
        extract(
            clientSource,
            PLAN_MATRIX,
            `${name} = N`,
            new RegExp(`^export\\s+const\\s+${name}\\s*=\\s*(\\d+)\\s*;`, 'm'),
        ),
    ]),
);
for (const { name, value, file, anchor } of server) {
    if (value !== client[name]) {
        failed = true;
        console.error(
            `${name}${anchor ? ` (${anchor})` : ''}: SQL=${value} (${file}) != client=${client[name]} (${PLAN_MATRIX})`,
        );
    }
}
if (failed) {
    console.error('\nPlan caps drifted. SQL is the authority — update plan-matrix.ts (or ship both together).');
    process.exit(1);
}
process.stdout.write(
    `plan-caps: OK (monthly=${client.PRO_MONTHLY_BATCH_CAP}, trial=${client.TRIAL_DURATION_DAYS}d/${client.TRIAL_BATCH_CAP} batches, trial-event=${client.TRIAL_EVENT_DURATION_DAYS}d/default ${client.TRIAL_EVENT_BATCH_CAP} batches)\n`,
);
