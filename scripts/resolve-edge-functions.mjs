import { appendFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function resolveFunctions(paths, all) {
    const functions = new Set();
    for (const path of paths) {
        if (!path.startsWith('supabase/functions/')) continue;
        if (path.startsWith('supabase/functions/_shared/')) {
            // Only Polar-specific top-level modules/tests have a narrow dependency fanout.
            if (!/^supabase\/functions\/_shared\/polar[^/]*\.ts$/.test(path)) return [...all].sort();
            functions.add('polar-webhook');
            functions.add('create-polar-checkout');
        } else {
            const name = path.split('/')[2];
            if (!all.includes(name)) return [...all].sort();
            functions.add(name);
        }
    }
    return [...functions].sort();
}
export function chooseFunctions({ input, event, paths, all }) {
    if (input) {
        if (!all.includes(input)) throw new Error('Unknown function input');
        return [input];
    }
    if (event === 'workflow_dispatch' || paths === null) return [...all].sort();
    return resolveFunctions(paths, all);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const all = readdirSync('supabase/functions', { withFileTypes: true }).filter(x => x.isDirectory() && x.name !== '_shared').map(x => x.name);
    let paths = null;
    if (process.env.EVENT_NAME !== 'workflow_dispatch' && !process.env.FUNCTION_INPUT) {
        const before = process.env.BEFORE_SHA;
        try {
            const args = before && before !== '0'.repeat(40) ? ['diff','--name-only',`${before}...HEAD`,'--','supabase/functions/'] : ['diff','--name-only','HEAD~1','--','supabase/functions/'];
            paths = execFileSync('git', args, { encoding:'utf8' }).trim().split('\n').filter(Boolean);
        } catch { paths = null; } // Uncertain diff must never silently omit consumers.
    }
    const functions = chooseFunctions({ input:process.env.FUNCTION_INPUT, event:process.env.EVENT_NAME, paths, all });
    appendFileSync(process.env.GITHUB_OUTPUT, `functions=${JSON.stringify(functions)}\nproject_ref=vjdgdolfxvnxushxrmff\n`);
    console.log(`Selected ${functions.length} Edge functions`);
}
