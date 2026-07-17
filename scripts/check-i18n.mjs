// i18n 키 동기화 검사: en 기준 누락 키 검출. STRICT 로케일은 exit 1.
import { readFileSync } from 'node:fs';

const STRICT = ['ko'];
// ponytail: ja/zh-CN은 번역 착수 전(각 ~118키 누락)이라 warn-only. 번역 완료 시 STRICT로 이동.
const WARN = ['ja', 'zh-CN'];

const flat = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );

const load = (locale) => new Set(flat(JSON.parse(readFileSync(`src/shared/i18n/locales/${locale}.json`, 'utf8'))));

const en = load('en');
let failed = false;

for (const locale of [...STRICT, ...WARN]) {
    const keys = load(locale);
    const missing = [...en].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !en.has(k));
    const strict = STRICT.includes(locale);
    if (missing.length === 0) {
        console.log(`${locale}: OK${extra.length ? ` (${extra.length} extra keys not in en)` : ''}`);
        continue;
    }
    if (strict) failed = true;
    console.log(`${locale}: ${missing.length} missing${strict ? '' : ' (warn only)'}`);
    for (const k of missing.slice(0, 20)) console.log(`  - ${k}`);
    if (missing.length > 20) console.log(`  ... +${missing.length - 20} more`);
}

process.exit(failed ? 1 : 0);
