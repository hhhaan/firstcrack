/** Cupping form snapshot. Keep in sync with supabase/functions/_shared/cupping-form.ts and fc-landing/apps/cupping/src/form.ts */

export const FORM_SCHEMA_V = 1 as const;
export const MAX_FORM_FIELDS = 16;
export const MAX_SELECT_OPTIONS = 8;
export const FORM_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

export type FormPresetKey = 'sca_v1' | 'simple_5' | 'custom';
export type FormFieldType = 'slider' | 'pass_fail' | 'select';
export type ScoreValue = number | string;
export type FormScores = Record<string, ScoreValue>;

export type SliderField = {
    key: string;
    label: string;
    type?: 'slider';
    min: number;
    max: number;
    step: number;
};

export type PassFailField = {
    key: string;
    label: string;
    type: 'pass_fail';
};

export type SelectField = {
    key: string;
    label: string;
    type: 'select';
    options: string[];
};

export type FormField = SliderField | PassFailField | SelectField;

export type CuppingFormSchema = {
    v: typeof FORM_SCHEMA_V;
    key: FormPresetKey;
    name: string;
    fields: FormField[];
    scoring: { base: number; defectWeight: number };
};

export const SLIDER_SCALES = [
    { id: 'sca', min: 0, max: 10, step: 0.25 },
    { id: 'five', min: 0, max: 5, step: 1 },
    { id: 'stars', min: 1, max: 5, step: 1 },
] as const;

export type SliderScaleId = (typeof SLIDER_SCALES)[number]['id'] | 'custom';

const slider = (key: string, label: string): SliderField => ({
    key,
    label,
    type: 'slider',
    min: 0,
    max: 10,
    step: 0.25,
});

export const SCA_V1_FORM: CuppingFormSchema = {
    v: 1,
    key: 'sca_v1',
    name: 'SCA',
    fields: [
        slider('fragrance', 'Fragrance'),
        slider('aroma', 'Aroma'),
        slider('flavor', 'Flavor'),
        slider('aftertaste', 'Aftertaste'),
        slider('acidity', 'Acidity'),
        slider('body', 'Body'),
        slider('balance', 'Balance'),
        slider('overall', 'Overall'),
    ],
    scoring: { base: 36, defectWeight: 2 },
};

export const SIMPLE_5_FORM: CuppingFormSchema = {
    v: 1,
    key: 'simple_5',
    name: 'Simple 5',
    fields: [
        slider('fragrance', 'Fragrance'),
        slider('flavor', 'Flavor'),
        slider('acidity', 'Acidity'),
        slider('body', 'Body'),
        slider('overall', 'Overall'),
    ],
    scoring: { base: 0, defectWeight: 2 },
};

export const PRESET_FORMS: Record<'sca_v1' | 'simple_5', CuppingFormSchema> = {
    sca_v1: SCA_V1_FORM,
    simple_5: SIMPLE_5_FORM,
};

export function fieldType(field: FormField): FormFieldType {
    return field.type ?? 'slider';
}

export function isSliderField(field: FormField): field is SliderField {
    return fieldType(field) === 'slider';
}

export function cloneForm(source: CuppingFormSchema, name: string): CuppingFormSchema {
    return {
        v: 1,
        key: 'custom',
        name: name.trim().slice(0, 80) || source.name,
        fields: source.fields.map((f) => ({ ...f })),
        scoring: { ...source.scoring },
    };
}

function isFiniteNumber(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n);
}

export function sliderScaleId(field: SliderField): SliderScaleId {
    const hit = SLIDER_SCALES.find((s) => s.min === field.min && s.max === field.max && s.step === field.step);
    return hit?.id ?? 'custom';
}

export function isValidFieldStep(value: number, field: SliderField): boolean {
    if (!Number.isFinite(value) || value < field.min || value > field.max) return false;
    if (field.step <= 0) return false;
    const n = (value - field.min) / field.step;
    return Math.abs(n - Math.round(n)) < 1e-6;
}

export function clampFieldScore(value: number, field: SliderField): number {
    if (!Number.isFinite(value)) return field.min;
    const stepped = field.min + Math.round((value - field.min) / field.step) * field.step;
    return Math.min(field.max, Math.max(field.min, stepped));
}

export function defaultScoresForForm(schema: CuppingFormSchema, fill = 6): FormScores {
    const out: FormScores = {};
    for (const f of schema.fields) {
        if (isSliderField(f)) out[f.key] = clampFieldScore(fill, f);
        else if (f.type === 'pass_fail') out[f.key] = 1;
        else out[f.key] = f.options[0] ?? '';
    }
    return out;
}

function parseSelectOptions(raw: unknown, key: string): string[] {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_SELECT_OPTIONS) {
        throw new Error(`select options 2–${MAX_SELECT_OPTIONS}: ${key}`);
    }
    const seen = new Set<string>();
    const options: string[] = [];
    for (const item of raw) {
        if (typeof item !== 'string') throw new Error(`invalid option: ${key}`);
        const opt = item.trim().slice(0, 40);
        if (!opt || seen.has(opt.toLowerCase())) continue;
        seen.add(opt.toLowerCase());
        options.push(opt);
    }
    if (options.length < 2) throw new Error(`select options 2–${MAX_SELECT_OPTIONS}: ${key}`);
    return options;
}

function parseField(raw: unknown, seen: Set<string>): FormField {
    if (!raw || typeof raw !== 'object') throw new Error('invalid field');
    const f = raw as Record<string, unknown>;
    if (typeof f.key !== 'string' || !FORM_KEY_RE.test(f.key)) throw new Error(`invalid field key: ${f.key}`);
    if (seen.has(f.key)) throw new Error(`duplicate field: ${f.key}`);
    seen.add(f.key);
    const label = typeof f.label === 'string' ? f.label.trim().slice(0, 40) : '';
    if (!label) throw new Error(`field label required: ${f.key}`);
    const type = f.type == null || f.type === 'slider' ? 'slider' : f.type;
    if (type === 'pass_fail') return { key: f.key, label, type: 'pass_fail' };
    if (type === 'select') {
        return { key: f.key, label, type: 'select', options: parseSelectOptions(f.options, f.key) };
    }
    if (type !== 'slider') throw new Error(`invalid field type: ${f.key}`);
    if (!isFiniteNumber(f.min) || !isFiniteNumber(f.max) || !isFiniteNumber(f.step)) {
        throw new Error(`invalid range: ${f.key}`);
    }
    if (f.max <= f.min || f.step <= 0 || f.step > f.max - f.min) throw new Error(`invalid range: ${f.key}`);
    return { key: f.key, label, type: 'slider', min: f.min, max: f.max, step: f.step };
}

export function parseFormSchema(input: unknown): CuppingFormSchema {
    if (!input || typeof input !== 'object') throw new Error('form schema required');
    const obj = input as Record<string, unknown>;
    if (obj.v !== 1) throw new Error('unsupported form schema');
    const key = obj.key;
    if (key !== 'sca_v1' && key !== 'simple_5' && key !== 'custom') throw new Error('invalid form key');
    const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, 80) : '';
    if (!name) throw new Error('form name required');
    if (!Array.isArray(obj.fields) || obj.fields.length < 1 || obj.fields.length > MAX_FORM_FIELDS) {
        throw new Error('form fields 1–16');
    }
    const scoringRaw = obj.scoring;
    if (!scoringRaw || typeof scoringRaw !== 'object') throw new Error('scoring required');
    const scoringObj = scoringRaw as Record<string, unknown>;
    if (!isFiniteNumber(scoringObj.base) || scoringObj.base < 0 || scoringObj.base > 100) {
        throw new Error('invalid scoring.base');
    }
    if (!isFiniteNumber(scoringObj.defectWeight) || scoringObj.defectWeight < 0 || scoringObj.defectWeight > 20) {
        throw new Error('invalid scoring.defectWeight');
    }

    const seen = new Set<string>();
    const fields = obj.fields.map((raw) => parseField(raw, seen));

    return {
        v: 1,
        key,
        name,
        fields,
        scoring: { base: scoringObj.base, defectWeight: scoringObj.defectWeight },
    };
}

/** Missing or invalid snapshot → SCA v1 (legacy events). */
export function formSchemaOrSca(input: unknown): CuppingFormSchema {
    if (input == null) return SCA_V1_FORM;
    try {
        return parseFormSchema(input);
    } catch {
        return SCA_V1_FORM;
    }
}

export function parseScoresForForm(schema: CuppingFormSchema, input: unknown): FormScores {
    if (!input || typeof input !== 'object') throw new Error('scores must be an object');
    const obj = input as Record<string, unknown>;
    const out: FormScores = {};
    for (const field of schema.fields) {
        const v = obj[field.key];
        if (isSliderField(field)) {
            if (typeof v !== 'number' || !isValidFieldStep(v, field)) {
                throw new Error(`invalid score: ${field.key}`);
            }
            out[field.key] = v;
            continue;
        }
        if (field.type === 'pass_fail') {
            if (v !== 0 && v !== 1) throw new Error(`invalid score: ${field.key}`);
            out[field.key] = v;
            continue;
        }
        if (typeof v !== 'string' || !field.options.includes(v)) {
            throw new Error(`invalid score: ${field.key}`);
        }
        out[field.key] = v;
    }
    return out;
}

export function totalScoreForForm(schema: CuppingFormSchema, scores: FormScores, defects: number): number {
    const sum = schema.fields.reduce((acc, f) => {
        if (!isSliderField(f)) return acc;
        const v = scores[f.key];
        return acc + (typeof v === 'number' ? v : 0);
    }, 0);
    return schema.scoring.base + sum - Math.max(0, defects) * schema.scoring.defectWeight;
}

export type ChoiceCount = { value: string; count: number };
export type ChoiceTally = {
    key: string;
    label: string;
    type: 'pass_fail' | 'select';
    counts: ChoiceCount[];
};

export function passFailLabel(value: unknown): 'Pass' | 'Fail' | null {
    if (value === 1) return 'Pass';
    if (value === 0) return 'Fail';
    return null;
}

export function tallyChoiceFields(
    schema: CuppingFormSchema,
    rows: Array<{ scores?: Record<string, unknown> | null }>,
): ChoiceTally[] {
    const out: ChoiceTally[] = [];
    for (const field of schema.fields) {
        if (field.type === 'pass_fail') {
            let pass = 0;
            let fail = 0;
            for (const row of rows) {
                const v = row.scores?.[field.key];
                if (v === 1) pass += 1;
                else if (v === 0) fail += 1;
            }
            out.push({
                key: field.key,
                label: field.label,
                type: 'pass_fail',
                counts: [
                    { value: 'Pass', count: pass },
                    { value: 'Fail', count: fail },
                ],
            });
            continue;
        }
        if (field.type !== 'select') continue;
        const map = new Map<string, number>(field.options.map((opt) => [opt, 0]));
        for (const row of rows) {
            const v = row.scores?.[field.key];
            if (typeof v === 'string' && map.has(v)) map.set(v, (map.get(v) ?? 0) + 1);
        }
        out.push({
            key: field.key,
            label: field.label,
            type: 'select',
            counts: [...map.entries()].map(([value, count]) => ({ value, count })),
        });
    }
    return out;
}

export function choiceValuesForScores(
    schema: CuppingFormSchema,
    scores: Record<string, unknown> | null | undefined,
): Array<{ label: string; value: string }> {
    if (!scores) return [];
    const out: Array<{ label: string; value: string }> = [];
    for (const field of schema.fields) {
        if (field.type === 'pass_fail') {
            const v = passFailLabel(scores[field.key]);
            if (v) out.push({ label: field.label, value: v });
            continue;
        }
        if (field.type === 'select') {
            const v = scores[field.key];
            if (typeof v === 'string' && v) out.push({ label: field.label, value: v });
        }
    }
    return out;
}

export function slugFieldKey(label: string, used: Set<string>): string {
    const ascii = label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 32);
    let base = ascii && FORM_KEY_RE.test(ascii) ? ascii : 'field';
    if (!FORM_KEY_RE.test(base)) base = 'field';
    let key = base;
    let i = 2;
    while (used.has(key)) {
        const suffix = `_${i}`;
        key = `${base.slice(0, 32 - suffix.length)}${suffix}`;
        i += 1;
    }
    return key;
}
