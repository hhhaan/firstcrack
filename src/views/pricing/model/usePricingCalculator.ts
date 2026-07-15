import { useBeans } from '@entities/bean/queries';
import type { BlendWithComponents } from '@entities/blend/api';
import { useBlends } from '@entities/blend/queries';
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
import { logger } from '@shared/lib/logger';
import { pricingStore } from '@shared/lib/pricingStore';
import { useAuthStore } from '@shared/store/auth';
import { normalizePct } from '@widgets/cost-calculator/lib/format';
import type {
    BlendComponentCost,
    BlendSourceMode,
    FixedOverheadItem,
    SourceMode,
} from '@widgets/cost-calculator/lib/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const newRowId = () => crypto.randomUUID();
const SAVE_DEBOUNCE_MS = 200;

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

const blendToComponents = (blend: BlendWithComponents, beans: { id: string; cost_per_kg: number | null }[]) =>
    blend.blend_components.map((c) => {
        const bean = beans.find((b) => b.id === c.bean_id);
        return {
            id: c.id,
            beanId: c.bean_id,
            name: c.beans.name,
            ratioPct: Number(c.ratio_pct),
            costPerKg: bean?.cost_per_kg ?? null,
        };
    });

export const usePricingCalculator = () => {
    const { i18n } = useTranslation();
    const lang = i18n.language;
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: beans = [] } = useBeans(userId);
    const { data: blends = [] } = useBlends(userId);

    const [mode, setMode] = useState<SourceMode>('single');
    const [selectedBeanId, setSelectedBeanId] = useState<string | null>(null);
    const [greenCostOverride, setGreenCostOverride] = useState<number | null>(null);
    const [blendSource, setBlendSource] = useState<BlendSourceMode>('saved');
    const [selectedBlendId, setSelectedBlendId] = useState<string | null>(null);
    const [blendComponents, setBlendComponents] = useState<BlendComponentCost[]>([emptyRow()]);
    const [yieldPct, setYieldPct] = useState(DEFAULT_YIELD_PCT);
    const [fixedOverheads, setFixedOverheads] = useState<FixedOverheadItem[]>([]);
    const [overheadsReady, setOverheadsReady] = useState(false);
    const [marginPct, setMarginPct] = useState(40);
    const [priceDriven, setPriceDriven] = useState(false);
    const [sellingPriceOverride, setSellingPriceOverride] = useState<number | null>(null);

    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        let cancelled = false;
        pricingStore.getFixedOverheads().then((items) => {
            if (cancelled) return;
            setFixedOverheads(items);
            setOverheadsReady(true);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const persistOverheads = useCallback((items: FixedOverheadItem[]) => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            pricingStore.setFixedOverheads(items).catch((err) => {
                logger.capture(err, { context: 'pricing.fixedOverheads.persist' });
            });
        }, SAVE_DEBOUNCE_MS);
    }, []);

    useEffect(() => {
        return () => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
        };
    }, []);

    const updateOverheads = useCallback(
        (next: FixedOverheadItem[] | ((prev: FixedOverheadItem[]) => FixedOverheadItem[])) => {
            setFixedOverheads((prev) => {
                const resolved = typeof next === 'function' ? next(prev) : next;
                if (overheadsReady) persistOverheads(resolved);
                return resolved;
            });
            setPriceDriven(false);
            setSellingPriceOverride(null);
        },
        [overheadsReady, persistOverheads],
    );

    const selectedBean = beans.find((b) => b.id === selectedBeanId) ?? null;

    const resetPricing = useCallback(() => {
        setPriceDriven(false);
        setSellingPriceOverride(null);
    }, []);

    const handleModeChange = (next: SourceMode) => {
        setMode(next);
        resetPricing();
        if (next === 'blend' && blendSource === 'custom' && blendComponents.length === 0) {
            setBlendComponents([emptyRow()]);
        }
    };

    const handleBeanSelect = (beanId: string) => {
        setSelectedBeanId(beanId || null);
        const bean = beans.find((b) => b.id === beanId);
        setGreenCostOverride(bean?.cost_per_kg ?? null);
        resetPricing();
    };

    const handleBlendSelect = (blendId: string) => {
        setSelectedBlendId(blendId || null);
        const blend = blends.find((b) => b.id === blendId);
        if (blend) {
            setBlendComponents(blendToComponents(blend, beans));
        }
        resetPricing();
    };

    const handleBlendSourceChange = (next: BlendSourceMode) => {
        setBlendSource(next);
        setSelectedBlendId(null);
        setBlendComponents(next === 'custom' ? [emptyRow()] : []);
        resetPricing();
    };

    useEffect(() => {
        if (blendSource !== 'saved' || !selectedBlendId) return;
        const blend = blends.find((b) => b.id === selectedBlendId);
        if (!blend) return;
        setBlendComponents(blendToComponents(blend, beans));
    }, [beans, blendSource, selectedBlendId, blends]);

    const handleBlendComponentChange = (id: string, patch: Partial<BlendComponentCost>) => {
        setBlendComponents((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
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
        setBlendComponents((rows) => [...rows, emptyRow()]);
    };

    const handleRemoveBlendRow = (id: string) => {
        setBlendComponents((rows) => rows.filter((r) => r.id !== id));
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
        if (priceDriven && sellingPriceOverride !== null) return sellingPriceOverride;
        return sellingPriceFromMargin(totalCost, marginPct);
    }, [priceDriven, sellingPriceOverride, totalCost, marginPct]);

    const displayMargin = priceDriven
        ? normalizePct(marginFromSellingPrice(totalCost, sellingPricePerKg), lang)
        : normalizePct(marginPct, lang);

    const handleMarginChange = (value: number) => {
        const clamped = Math.min(80, Math.max(0, normalizePct(value, lang)));
        setMarginPct(clamped);
        setPriceDriven(false);
        setSellingPriceOverride(null);
    };

    const handleSellingPriceChange = (value: number) => {
        setSellingPriceOverride(value);
        setPriceDriven(true);
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
