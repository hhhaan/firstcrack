import { useBeans } from '@entities/bean/queries';
import type { BlendWithComponents } from '@entities/blend/api';
import { useBlends } from '@entities/blend/queries';
import { useActiveWorkspace } from '@entities/organization';
import {
    blendGreenCostPerKg,
    DEFAULT_YIELD_PCT,
    marginFromSellingPrice,
    profitPerKg,
    roastedCostPerKg,
    sellingPriceFromMargin,
    sumOverheadPerKg,
    totalCostPerKg,
} from '@shared/lib/cost-calc';
import { getFixedOverheads, setFixedOverheads, useFixedOverheads } from '@shared/lib/pricingStore';
import { normalizePct } from '@widgets/cost-calculator/lib/format';
import type {
    BlendComponentCost,
    BlendSourceMode,
    FixedOverheadItem,
    SourceMode,
} from '@widgets/cost-calculator/lib/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const newRowId = () => crypto.randomUUID();

const emptyRow = (): BlendComponentCost => ({
    id: newRowId(),
    beanId: '',
    name: '',
    ratioPct: 0,
    costPerKg: null,
});

const emptyOverhead = (): FixedOverheadItem => ({
    id: newRowId(),
    name: '',
    amountPerKg: 0,
});

type BlendDraft =
    | { source: 'saved'; id: string | null; costs: Partial<Record<string, number | null>> }
    | { source: 'custom'; components: BlendComponentCost[] };

const blendToComponents = (
    blend: BlendWithComponents,
    beans: { id: string; cost_per_kg: number | null }[],
    costs: Partial<Record<string, number | null>>,
) =>
    blend.blend_components.map((c) => {
        const bean = beans.find((b) => b.id === c.bean_id);
        const cost = costs[c.id];
        return {
            id: c.id,
            beanId: c.bean_id,
            name: c.beans.name,
            ratioPct: Number(c.ratio_pct),
            costPerKg: cost !== undefined ? cost : (bean?.cost_per_kg ?? null),
        };
    });

export const usePricingCalculator = () => {
    const { i18n } = useTranslation();
    const lang = i18n.language;
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: beans = [] } = useBeans(userId);
    const { data: blends = [] } = useBlends(userId);

    const [mode, setMode] = useState<SourceMode>('single');
    const [selectedBeanId, setSelectedBeanId] = useState<string | null>(null);
    const [greenCostOverride, setGreenCostOverride] = useState<number | null>(null);
    const [blendDraft, setBlendDraft] = useState<BlendDraft>({ source: 'saved', id: null, costs: {} });
    const [yieldPct, setYieldPct] = useState(DEFAULT_YIELD_PCT);
    const fixedOverheads = useFixedOverheads();
    const [marginPct, setMarginPct] = useState(40);
    const [sellingPriceOverride, setSellingPriceOverride] = useState<number | null>(null);

    const blendSource = blendDraft.source;
    const selectedBlendId = blendDraft.source === 'saved' ? blendDraft.id : null;
    const blendComponents = useMemo(() => {
        if (blendDraft.source === 'custom') return blendDraft.components;
        const blend = blends.find((item) => item.id === blendDraft.id);
        return blend ? blendToComponents(blend, beans, blendDraft.costs) : [];
    }, [blendDraft, blends, beans]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: query updates reset edited costs, matching the former row replacement.
    useEffect(() => {
        setBlendDraft((draft) =>
            draft.source === 'saved' && Object.keys(draft.costs).length > 0 ? { ...draft, costs: {} } : draft,
        );
    }, [beans, blends]);

    const updateOverheads = useCallback(
        (next: FixedOverheadItem[] | ((prev: FixedOverheadItem[]) => FixedOverheadItem[])) => {
            setFixedOverheads(typeof next === 'function' ? next(getFixedOverheads()) : next);
            setSellingPriceOverride(null);
        },
        [],
    );

    const selectedBean = beans.find((b) => b.id === selectedBeanId) ?? null;

    const resetPricing = useCallback(() => {
        setSellingPriceOverride(null);
    }, []);

    const handleModeChange = (next: SourceMode) => {
        setMode(next);
        resetPricing();
        if (next === 'blend' && blendSource === 'custom' && blendComponents.length === 0) {
            setBlendDraft({ source: 'custom', components: [emptyRow()] });
        }
    };

    const handleBeanSelect = (beanId: string) => {
        setSelectedBeanId(beanId || null);
        const bean = beans.find((b) => b.id === beanId);
        setGreenCostOverride(bean?.cost_per_kg ?? null);
        resetPricing();
    };

    const handleBlendSelect = (blendId: string) => {
        setBlendDraft({ source: 'saved', id: blendId || null, costs: {} });
        resetPricing();
    };

    const handleBlendSourceChange = (next: BlendSourceMode) => {
        setBlendDraft(
            next === 'custom'
                ? { source: 'custom', components: [emptyRow()] }
                : { source: 'saved', id: null, costs: {} },
        );
        resetPricing();
    };

    const handleBlendComponentChange = (id: string, patch: Partial<BlendComponentCost>) => {
        setBlendDraft((draft) => {
            if (draft.source === 'custom') {
                return {
                    ...draft,
                    components: draft.components.map((row) => (row.id === id ? { ...row, ...patch } : row)),
                };
            }
            if (patch.costPerKg === undefined) return draft;
            return { ...draft, costs: { ...draft.costs, [id]: patch.costPerKg } };
        });
        resetPricing();
    };

    const handleBlendComponentBeanSelect = (id: string, beanId: string) => {
        if (!beanId) {
            // Free-text path keeps name/cost; full clear goes through onFreeText('').
            handleBlendComponentChange(id, { beanId: '' });
            return;
        }
        const bean = beans.find((b) => b.id === beanId);
        handleBlendComponentChange(id, {
            beanId,
            name: bean?.name ?? '',
            costPerKg: bean?.cost_per_kg ?? null,
        });
    };

    const handleAddBlendRow = () => {
        setBlendDraft((draft) =>
            draft.source === 'custom' ? { ...draft, components: [...draft.components, emptyRow()] } : draft,
        );
    };

    const handleRemoveBlendRow = (id: string) => {
        setBlendDraft((draft) =>
            draft.source === 'custom'
                ? { ...draft, components: draft.components.filter((row) => row.id !== id) }
                : draft,
        );
        resetPricing();
    };

    const handleGreenCostChange = (value: number) => {
        setGreenCostOverride(value);
        resetPricing();
    };

    const handleYieldChange = (value: number) => {
        setYieldPct(value);
        resetPricing();
    };

    const handleOverheadItemChange = (id: string, patch: Partial<FixedOverheadItem>) => {
        updateOverheads((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    };

    const handleAddOverheadItem = () => {
        updateOverheads((rows) => [...rows, emptyOverhead()]);
    };

    const handleRemoveOverheadItem = (id: string) => {
        updateOverheads((rows) => rows.filter((r) => r.id !== id));
    };

    const greenCostPerKg = useMemo(() => {
        if (mode === 'single') {
            if (greenCostOverride !== null) return greenCostOverride;
            return selectedBean?.cost_per_kg ?? 0;
        }
        return blendGreenCostPerKg(blendComponents.map((c) => ({ ratioPct: c.ratioPct, costPerKg: c.costPerKg })));
    }, [mode, greenCostOverride, selectedBean, blendComponents]);

    const overheadPerKg = useMemo(() => sumOverheadPerKg(fixedOverheads), [fixedOverheads]);
    const roastedCost = roastedCostPerKg(greenCostPerKg, yieldPct);
    const totalCost = totalCostPerKg(roastedCost, overheadPerKg);

    const sellingPricePerKg = useMemo(() => {
        if (sellingPriceOverride !== null) return sellingPriceOverride;
        return sellingPriceFromMargin(totalCost, marginPct);
    }, [sellingPriceOverride, totalCost, marginPct]);

    const displayMargin =
        sellingPriceOverride !== null
            ? normalizePct(marginFromSellingPrice(totalCost, sellingPricePerKg), lang)
            : normalizePct(marginPct, lang);

    const handleMarginChange = (value: number) => {
        const clamped = Math.min(80, Math.max(0, normalizePct(value, lang)));
        setMarginPct(clamped);
        setSellingPriceOverride(null);
    };

    const handleSellingPriceChange = (value: number) => {
        setSellingPriceOverride(value);
        if (value > 0 && totalCost > 0) {
            setMarginPct(Math.min(80, Math.max(0, normalizePct(marginFromSellingPrice(totalCost, value), lang))));
        }
    };

    // Warn when inventory bean has no registered cost and display cost is still empty.
    const missingBeanCost =
        mode === 'single' && !!selectedBeanId && selectedBean?.cost_per_kg == null && greenCostPerKg <= 0;

    return {
        beans,
        blends,
        mode,
        selectedBeanId,
        blendSource,
        selectedBlendId,
        blendComponents,
        yieldPct,
        fixedOverheads,
        overheadPerKg,
        greenCostPerKg,
        roastedCost,
        totalCost,
        sellingPricePerKg,
        displayMargin,
        missingBeanCost,
        profit: profitPerKg(sellingPricePerKg, totalCost),
        handleModeChange,
        handleBeanSelect,
        handleBlendSelect,
        handleBlendSourceChange,
        handleBlendComponentChange,
        handleBlendComponentBeanSelect,
        handleAddBlendRow,
        handleRemoveBlendRow,
        handleGreenCostChange,
        handleYieldChange,
        handleOverheadItemChange,
        handleAddOverheadItem,
        handleRemoveOverheadItem,
        handleMarginChange,
        handleSellingPriceChange,
    };
};
