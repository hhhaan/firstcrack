import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ponytail: static DDL only, not a permission audit. Function bodies/dynamic SQL
// are literals; use a database-backed check if those start creating tables.
function tokens(sql) {
    const result = [];
    for (let i = 0; i < sql.length; ) {
        const rest = sql.slice(i);
        const space = /^(?:\s+|--[^\n]*)/.exec(rest);
        if (space) {
            i += space[0].length;
            continue;
        }
        if (rest.startsWith('/*')) {
            let depth = 1;
            i += 2;
            while (i < sql.length && depth) {
                if (sql.startsWith('/*', i)) {
                    depth++;
                    i += 2;
                } else if (sql.startsWith('*/', i)) {
                    depth--;
                    i += 2;
                } else i++;
            }
            if (depth) throw new Error('Unterminated SQL comment');
            continue;
        }
        const dollar = /^\$(?:[a-z_][\w]*)?\$/i.exec(rest);
        if (dollar) {
            const end = sql.indexOf(dollar[0], i + dollar[0].length);
            if (end < 0) throw new Error('Unterminated dollar-quoted SQL');
            i = end + dollar[0].length;
            result.push("'");
            continue;
        }
        const literal = /^(?:e'(?:[^'\\]|\\[\s\S]|'')*'|'(?:[^']|'')*')/i.exec(rest);
        if (literal) {
            i += literal[0].length;
            result.push("'");
            continue;
        }
        const identifier = /^"(?:[^"]|"")*"/.exec(rest);
        const word = /^[a-z_][\w$]*/i.exec(rest);
        if (rest[0] === "'" || (rest[0] === '"' && !identifier)) throw new Error('Unterminated SQL quote');
        const token = identifier?.[0] ?? word?.[0].toLowerCase() ?? rest[0];
        result.push(token);
        i += token.length;
    }
    return result;
}

function tableName(parts, start) {
    const identifier = /^(?:[a-z_][\w$]*|"(?:[^"]|"")+")$/;
    const names = [];
    let i = start;
    for (;;) {
        if (!identifier.test(parts[i] ?? '')) throw new Error('Cannot parse table name');
        const value = parts[i++];
        names.push(value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value);
        if (parts[i] !== '.') break;
        i++;
    }
    if (names.length > 2) throw new Error('Unsupported qualified table name');
    if (names.length === 1) names.unshift('public');
    return { key: JSON.stringify(names), end: i };
}

export function checkMigrationRls(sql) {
    const tables = new Map();
    const statements = [[]];
    for (const token of tokens(sql)) {
        if (token === ';') statements.push([]);
        else statements.at(-1).push(token);
    }
    for (const parts of statements) {
        if (parts[0] === 'create') {
            let i = 1;
            if (['global', 'local'].includes(parts[i])) i++;
            const temporary = ['temp', 'temporary'].includes(parts[i]);
            if (temporary || parts[i] === 'unlogged') i++;
            if (parts[i++] !== 'table') continue;
            if (parts.slice(i, i + 3).join(' ') === 'if not exists') i += 3;
            const { key, end } = tableName(parts, i);
            if (temporary) continue;
            if (!['(', 'as', 'of', 'partition'].includes(parts[end]))
                throw new Error(`Unsupported CREATE TABLE: ${key}`);
            tables.set(key, false);
        } else if (parts[0] === 'alter' && parts[1] === 'table') {
            let i = 2;
            if (parts.slice(i, i + 2).join(' ') === 'if exists') i += 2;
            if (parts[i] === 'only') i++;
            const { key, end } = tableName(parts, i);
            if (!tables.has(key)) continue;
            for (let j = end; j < parts.length; j++) {
                if (
                    ['enable', 'disable'].includes(parts[j]) &&
                    parts.slice(j + 1, j + 4).join(' ') === 'row level security'
                ) {
                    tables.set(key, parts[j] === 'enable');
                }
            }
        }
    }
    return [...tables].filter(([, enabled]) => !enabled).map(([name]) => name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const directory = process.argv[2] ?? 'supabase/migrations';
    const files = readdirSync(directory)
        .filter((file) => file.endsWith('.sql'))
        .sort();
    if (!files.length) throw new Error(`No migrations in ${directory}`);
    for (const file of files) {
        try {
            const missing = checkMigrationRls(readFileSync(join(directory, file), 'utf8'));
            if (missing.length) throw new Error(`Missing ENABLE ROW LEVEL SECURITY: ${missing.join(', ')}`);
        } catch (error) {
            console.error(`${file}: ${error.message}`);
            process.exitCode = 1;
        }
    }
}
