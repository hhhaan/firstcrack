/** @type {import('dependency-cruiser').IConfiguration} */
// FSD ranks: shared < entities < features < widgets < views < app (src/App.tsx, src/main.tsx).
// Tests may reach upward; production modules may not.
// Cross-slice entity/feature imports are forbidden. Cycles are warn until the
// existing barrel cycles are gone — see the architecture job output.
const testFile = String.raw`\.(test|spec)\.tsx?$`;

const upward = (from, to, comment) => ({
    name: `${from}-not-upward`,
    severity: 'error',
    comment,
    from: { path: `^src/${from}/`, pathNot: testFile },
    to: { path: to },
});

module.exports = {
    forbidden: [
        {
            name: 'no-circular',
            severity: 'warn',
            comment: 'Existing barrel cycles. New cycles should not be added; promote to error once this list is empty.',
            from: { path: '^src/', pathNot: testFile },
            to: { circular: true },
        },
        upward('shared', '^src/(entities|features|widgets|views)/', 'shared is the bottom layer.'),
        upward('entities', '^src/(features|widgets|views)/', 'entities do not import features, widgets, or views.'),
        upward('features', '^src/(widgets|views)/', 'features do not import widgets or views.'),
        upward('widgets', '^src/views/', 'widgets do not import views.'),
        {
            name: 'no-cross-entity',
            severity: 'error',
            comment: 'Entity slices do not import each other. Share code through shared/.',
            from: { path: '^src/entities/([^/]+)/', pathNot: testFile },
            to: { path: '^src/entities/([^/]+)/', pathNot: '^src/entities/$1/' },
        },
        {
            name: 'no-cross-feature',
            severity: 'error',
            comment: 'Feature slices do not import each other. Compose them in widgets or views.',
            from: { path: '^src/features/([^/]+)/', pathNot: testFile },
            to: { path: '^src/features/([^/]+)/', pathNot: '^src/features/$1/' },
        },
        {
            name: 'lower-not-to-app',
            severity: 'error',
            comment: 'Only the app shell imports src/App.tsx and src/main.tsx.',
            from: { path: '^src/(shared|entities|features|widgets|views)/', pathNot: testFile },
            to: { path: '^src/(App|main)\\.tsx$' },
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        exclude: { path: String.raw`(^|/)(node_modules|dist|coverage)/` },
        tsConfig: { fileName: 'tsconfig.json' },
        tsPreCompilationDeps: true,
        enhancedResolveOptions: {
            extensions: ['.ts', '.tsx', '.mjs', '.js', '.json'],
            conditionNames: ['import', 'types', 'node', 'default'],
        },
        skipAnalysisNotInRules: true,
    },
};
