import type { View } from '@shared/types/view';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { CostBreakdown } from '@widgets/cost-calculator/ui/CostBreakdown';
import { PricingResultPanel } from '@widgets/cost-calculator/ui/PricingResultPanel';
import { SourcePanel } from '@widgets/cost-calculator/ui/SourcePanel';
import { useTranslation } from 'react-i18next';
import { usePricingCalculator } from './model/usePricingCalculator';

export const Pricing = ({ onNavigate }: { onNavigate?: (view: View) => void }) => {
    const { t } = useTranslation();
    const calc = usePricingCalculator();

    return (
        <PageLayout>
            <PageHeader title={t('pricing.title')} />

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
                <div className="order-1 xl:order-2 xl:sticky xl:top-6">
                    <PricingResultPanel
                        marginPct={calc.displayMargin}
                        onMarginChange={calc.handleMarginChange}
                        sellingPricePerKg={calc.sellingPricePerKg}
                        onSellingPriceChange={calc.handleSellingPriceChange}
                        profitPerKg={calc.profit}
                        totalCostPerKg={calc.totalCost}
                        greenCostPerKg={calc.greenCostPerKg}
                        yieldPct={calc.yieldPct}
                        roastedCostPerKg={calc.roastedCost}
                        overheadPerKg={calc.overheadPerKg}
                    />
                </div>

                <div className="order-2 xl:order-1 flex min-w-0 flex-col gap-6">
                    <SourcePanel
                        mode={calc.mode}
                        onModeChange={calc.handleModeChange}
                        beans={calc.beans}
                        blends={calc.blends.map((b) => ({ id: b.id, name: b.name }))}
                        selectedBeanId={calc.selectedBeanId}
                        onBeanSelect={calc.handleBeanSelect}
                        greenCostPerKg={calc.greenCostPerKg}
                        onGreenCostChange={calc.handleGreenCostChange}
                        missingBeanCost={calc.missingBeanCost}
                        onGoToBeans={() => onNavigate?.('beans')}
                        blendSource={calc.blendSource}
                        onBlendSourceChange={calc.handleBlendSourceChange}
                        selectedBlendId={calc.selectedBlendId}
                        onBlendSelect={calc.handleBlendSelect}
                        blendComponents={calc.blendComponents}
                        onBlendComponentChange={calc.handleBlendComponentChange}
                        onBlendComponentBeanSelect={calc.handleBlendComponentBeanSelect}
                        onAddBlendRow={calc.handleAddBlendRow}
                        onRemoveBlendRow={calc.handleRemoveBlendRow}
                    />

                    <CostBreakdown
                        greenCostPerKg={calc.greenCostPerKg}
                        yieldPct={calc.yieldPct}
                        onYieldChange={calc.handleYieldChange}
                        roastedCostPerKg={calc.roastedCost}
                        fixedOverheads={calc.fixedOverheads}
                        overheadPerKg={calc.overheadPerKg}
                        onOverheadItemChange={calc.handleOverheadItemChange}
                        onAddOverheadItem={calc.handleAddOverheadItem}
                        onRemoveOverheadItem={calc.handleRemoveOverheadItem}
                        totalCostPerKg={calc.totalCost}
                        isBlend={calc.mode === 'blend'}
                    />
                </div>
            </div>
        </PageLayout>
    );
};
