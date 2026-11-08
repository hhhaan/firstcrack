import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(repoRoot, 'scripts/check-plan-caps.mjs');
const eventFile = 'supabase/migrations/20261104150333_trial_event_access.sql';
const capFile = 'supabase/migrations/20261106150000_trial_event_batch_cap.sql';
const matrixFile = 'src/shared/lib/features/plan-matrix.ts';
const original = Object.fromEntries(
    [eventFile, capFile, matrixFile].map((file) => [file, readFileSync(join(repoRoot, file), 'utf8')]),
);

// Spawn the real CLI against isolated copies of the checked-in migration/client inputs.
function runFixture(change = () => {}) {
    const root = mkdtempSync(join(tmpdir(), 'firstcrack-plan-caps-'));
    const files = { ...original };
    try {
        change(files);
        for (const [file, content] of Object.entries(files)) {
            mkdirSync(dirname(join(root, file)), { recursive: true });
            writeFileSync(join(root, file), content);
        }
        return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}
function replace(files, file, before, after) {
    assert.ok(files[file].includes(before), `fixture anchor not found: ${before}`);
    files[file] = files[file].replace(before, after);
}
function expectFailure(result, message) {
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, message);
}

test('current migrated schema passes: dynamic event100, ordinary trial20, monthly200, durations', () => {
    const result = runFixture();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /monthly=200, trial=14d\/20 batches, trial-event=90d\/default 100 batches/);
});

for (const [name, before, after, message] of [
    ['column default drift', 'DEFAULT 100;', 'DEFAULT 101;', /TRIAL_EVENT_BATCH_CAP \(column default\): SQL=101/],
    [
        'usage fallback drift',
        'coalesce(g.batch_cap, 100)',
        'coalesce(g.batch_cap, 101)',
        /TRIAL_EVENT_BATCH_CAP \(usage fallback\): SQL=101/,
    ],
    [
        'missing column default',
        'integer NOT NULL DEFAULT 100;',
        'integer NOT NULL;',
        /anchor "event cap column default"/,
    ],
    [
        'missing fallback',
        'batch_cap := coalesce(g.batch_cap, 100);',
        'batch_cap := g.batch_cap;',
        /anchor "event Charge cap fallback"/,
    ],
    ['normal trial cap drift', 'batch_cap := 20;', 'batch_cap := 21;', /TRIAL_BATCH_CAP: SQL=21/],
    ['monthly cap drift', 'THEN batch_cap := 200;', 'THEN batch_cap := 201;', /PRO_MONTHLY_BATCH_CAP: SQL=201/],
    ['trial duration drift', "interval '14 days'", "interval '15 days'", /TRIAL_DURATION_DAYS: SQL=15/],
    ['missing normal trial cap', 'batch_cap := 20;', 'batch_cap := NULL;', /anchor "trial Charge cap"/],
    ['missing monthly cap', 'THEN batch_cap := 200;', 'THEN batch_cap := NULL;', /anchor "monthly Charge cap"/],
    [
        'missing trial duration',
        "period_end := v_created + interval '14 days';",
        'period_end := NULL;',
        /anchor "trial duration days"/,
    ],
]) {
    test(name, () => {
        expectFailure(
            runFixture((files) => replace(files, capFile, before, after)),
            message,
        );
    });
}

for (const [name, after] of [
    ['event duration drift', "interval '2184 hours'"],
    ['missing event duration', "interval '90 days'"],
]) {
    test(name, () => {
        expectFailure(
            runFixture((files) => replace(files, eventFile, "interval '2160 hours'", after)),
            /TRIAL_EVENT_DURATION_DAYS: SQL=91|anchor "event duration hours"/,
        );
    });
}

test('event fallback cannot be borrowed from the next trial branch or an older function definition', () => {
    expectFailure(
        runFixture((files) => {
            replace(files, capFile, 'batch_cap := coalesce(g.batch_cap, 100);', 'batch_cap := g.batch_cap;');
            replace(files, capFile, 'batch_cap := 20;', 'batch_cap := coalesce(g.batch_cap, 100);');
        }),
        /anchor "event Charge cap fallback"/,
    );
});

test('unrelated function caps cannot fill missing anchors in the usage function', () => {
    expectFailure(
        runFixture((files) => {
            replace(files, capFile, 'batch_cap := coalesce(g.batch_cap, 100);', 'batch_cap := g.batch_cap;');
            files[capFile] += `\nCREATE FUNCTION private.unrelated() RETURNS void AS $$
BEGIN IF plan = 'trial-event' THEN batch_cap := coalesce(g.batch_cap, 100); END IF; END;
$$ LANGUAGE plpgsql;\n`;
        }),
        /anchor "event Charge cap fallback"/,
    );
});

for (const [operation, message] of [
    ['SET DEFAULT 100', null],
    ['SET DEFAULT 101', /TRIAL_EVENT_BATCH_CAP \(column default\): SQL=101/],
    ['DROP DEFAULT', /anchor "event cap column default"/],
]) {
    test(`newest column operation ${operation} overrides older default anchor`, () => {
        const result = runFixture((files) => {
            files['supabase/migrations/20990101000000_default.sql'] =
                `ALTER TABLE public.trial_event_grants ALTER COLUMN batch_cap ${operation};`;
        });
        if (message) expectFailure(result, message);
        else assert.equal(result.status, 0, result.stderr);
    });
}

for (const after of ['export const TRIAL_EVENT_BATCH_CAP = 101;', 'const TRIAL_EVENT_BATCH_CAP = 100;']) {
    test(`client anchor drift or removal: ${after}`, () => {
        expectFailure(
            runFixture((files) => {
                replace(files, matrixFile, 'export const TRIAL_EVENT_BATCH_CAP = 100;', after);
            }),
            /TRIAL_EVENT_BATCH_CAP.*SQL=100|anchor "TRIAL_EVENT_BATCH_CAP = N"/,
        );
    });
}
