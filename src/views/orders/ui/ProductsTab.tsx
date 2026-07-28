import type { Product } from '@entities/product';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { ProductsTable } from '@widgets/products-table';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Orders → Products renders the same table Beans owns; only the "new product" affordance differs.
 * Beans puts it in its PageHeader action slot, which Orders has no equivalent of, so the toolbar
 * lives here and the table itself stays shared.
 */
export function ProductsTab() {
    const { t } = useTranslation();
    const [addOpen, setAddOpen] = useState(false);
    const [editing, setEditing] = useState<Product | null>(null);

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <SurfaceButton
                    onClick={() => {
                        setEditing(null);
                        setAddOpen(true);
                    }}
                    icon={<Plus size={14} strokeWidth={2} />}
                    className="px-4 py-2"
                >
                    {t('orders.product.newTitle')}
                </SurfaceButton>
            </div>

            <ProductsTable
                addOpen={addOpen}
                onAddOpenChange={setAddOpen}
                editing={editing}
                onEditingChange={setEditing}
            />
        </div>
    );
}
