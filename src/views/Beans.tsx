import { Plus, Search, TrendingDown, AlertTriangle, CheckCircle, Edit3 } from 'lucide-react';
import { useState } from 'react';
import AddBeanModal from '../widgets/add-bean-modal/ui/AddBeanModal';
import { View } from '../shared/types/view';

const beans = [
    {
        id: 1,
        name: 'Ethiopia Yirgacheffe',
        origin: 'Ethiopia',
        region: 'Guji Zone',
        farm: 'Shakiso Cooperative',
        altitude: 2100,
        process: 'Natural',
        variety: 'Heirloom',
        stock: 1850,
        capacity: 5000,
        purchaseDate: '2026-03-10',
        tasting: 'Jasmine, Blueberry, Dark Chocolate',
        status: 'Good',
    },
    {
        id: 2,
        name: 'Colombia Huila',
        origin: 'Colombia',
        region: 'Huila Department',
        farm: 'Finca El Paraiso',
        altitude: 1850,
        process: 'Washed',
        variety: 'Castillo',
        stock: 3200,
        capacity: 5000,
        purchaseDate: '2026-03-20',
        tasting: 'Caramel, Red Apple, Hazelnut',
        status: 'Good',
    },
    {
        id: 3,
        name: 'Brazil Cerrado',
        origin: 'Brazil',
        region: 'Cerrado Mineiro',
        farm: 'Fazenda Santa Inês',
        altitude: 1100,
        process: 'Natural',
        variety: 'Catuai',
        stock: 890,
        capacity: 5000,
        purchaseDate: '2026-02-15',
        tasting: 'Dark Chocolate, Walnut, Brown Sugar',
        status: 'Low',
    },
    {
        id: 4,
        name: 'Kenya AA',
        origin: 'Kenya',
        region: 'Nyeri County',
        farm: 'Gakuyuni Cooperative',
        altitude: 1700,
        process: 'Washed',
        variety: 'SL28 / SL34',
        stock: 2100,
        capacity: 5000,
        purchaseDate: '2026-03-25',
        tasting: 'Blackcurrant, Tomato, Grapefruit',
        status: 'Good',
    },
    {
        id: 5,
        name: 'Guatemala Antigua',
        origin: 'Guatemala',
        region: 'Antigua Valley',
        farm: 'El Injerto',
        altitude: 1600,
        process: 'Honey',
        variety: 'Bourbon',
        stock: 0,
        capacity: 3000,
        purchaseDate: '2026-01-10',
        tasting: 'Peach, Brown Sugar, Milk Chocolate',
        status: 'Out',
    },
    {
        id: 6,
        name: 'Panama Gesha',
        origin: 'Panama',
        region: 'Boquete',
        farm: 'Hacienda La Esmeralda',
        altitude: 1600,
        process: 'Natural',
        variety: 'Gesha',
        stock: 500,
        capacity: 2000,
        purchaseDate: '2026-04-01',
        tasting: 'Jasmine, Peach, Bergamot',
        status: 'Low',
    },
];

const statusConfig = {
    Good: { color: '#16a34a', bg: 'rgba(220,252,231,0.8)', icon: CheckCircle, label: 'In Stock' },
    Low: { color: '#d97706', bg: 'rgba(254,243,199,0.8)', icon: AlertTriangle, label: 'Low Stock' },
    Out: { color: '#dc2626', bg: 'rgba(254,226,226,0.8)', icon: TrendingDown, label: 'Out of Stock' },
};

const processColor = {
    Natural: { color: '#92400e', bg: 'rgba(253,230,214,0.8)' },
    Washed: { color: '#1e40af', bg: 'rgba(219,234,254,0.8)' },
    Honey: { color: '#a16207', bg: 'rgba(254,243,199,0.8)' },
    // Adding fallbacks
    Anaerobic: { color: '#7e22ce', bg: 'rgba(243,232,255,0.8)' },
    Experimental: { color: '#be185d', bg: 'rgba(252,231,243,0.8)' },
};

interface BeansProps {
    onNavigate?: (view: View) => void;
}

export default function Beans({ onNavigate }: BeansProps) {
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<number | null>(1);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [modalConfig, setModalConfig] = useState<{
        tab: 'new' | 'restock' | 'edit';
        beanId: number | null;
        initialData?: any;
    }>({
        tab: 'new',
        beanId: null,
    });

    const handleOpenAddModal = (
        tab: 'new' | 'restock' | 'edit' = 'new',
        beanId: number | null = null,
        initialData: any = null,
    ) => {
        setModalConfig({ tab, beanId, initialData });
        setIsAddModalOpen(true);
    };

    const filtered = beans.filter(
        (b) =>
            b.name.toLowerCase().includes(search.toLowerCase()) ||
            b.origin.toLowerCase().includes(search.toLowerCase()),
    );

    const selected = beans.find((b) => b.id === selectedId);

    return (
        <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
            <AddBeanModal
                open={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                existingBeans={beans as any}
                initialTab={modalConfig.tab}
                initialBeanId={modalConfig.beanId}
                initialData={modalConfig.initialData}
            />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
                <div>
                    <h1
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 300,
                            fontSize: 32,
                            lineHeight: 1.13,
                            color: 'var(--color-primary)',
                            letterSpacing: '-0.4px',
                            marginBottom: 4,
                        }}
                    >
                        Bean Inventory
                    </h1>
                    <p style={{ fontSize: 14, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
                        {beans.filter((b) => b.status !== 'Out').length} active lots ·{' '}
                        {beans.filter((b) => b.status === 'Low').length} low stock ·{' '}
                        {beans.filter((b) => b.status === 'Out').length} out of stock
                    </p>
                </div>
                <button
                    onClick={() => handleOpenAddModal('new')}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 18px',
                        borderRadius: 9999,
                        border: 'none',
                        background: 'var(--color-primary)',
                        color: 'white',
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: 'pointer',
                        boxShadow: 'var(--shadow-card)',
                        letterSpacing: '0.14px',
                    }}
                >
                    <Plus size={15} strokeWidth={2.5} />
                    Add Bean Lot
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20 }}>
                {/* Bean list */}
                <div>
                    {/* Search */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            background: 'var(--color-main-bg)',
                            borderRadius: 10,
                            padding: '9px 12px',
                            marginBottom: 10,
                            boxShadow: 'var(--shadow-ring)',
                        }}
                    >
                        <Search size={14} strokeWidth={2} color="var(--color-muted)" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search beans..."
                            style={{
                                border: 'none',
                                background: 'transparent',
                                outline: 'none',
                                fontSize: 13,
                                color: 'var(--color-primary)',
                                fontFamily: 'var(--font-body)',
                                width: '100%',
                                letterSpacing: '0.14px',
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {filtered.map((bean) => {
                            const cfg = statusConfig[bean.status as keyof typeof statusConfig];
                            const pct = (bean.stock / bean.capacity) * 100;
                            const isSelected = selectedId === bean.id;

                            return (
                                <div
                                    key={bean.id}
                                    onClick={() => setSelectedId(bean.id)}
                                    style={{
                                        background: 'var(--color-main-bg)',
                                        borderRadius: 14,
                                        padding: '14px 16px',
                                        cursor: 'pointer',
                                        boxShadow: isSelected
                                            ? 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.06) 0px 2px 8px'
                                            : 'var(--shadow-ring)',
                                        border: isSelected ? '1px solid rgba(0,0,0,0.08)' : '1px solid transparent',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            justifyContent: 'space-between',
                                            marginBottom: 8,
                                        }}
                                    >
                                        <div>
                                            <div
                                                style={{
                                                    fontSize: 13,
                                                    fontWeight: 500,
                                                    color: 'var(--color-primary)',
                                                    letterSpacing: '0.14px',
                                                    marginBottom: 2,
                                                }}
                                            >
                                                {bean.name}
                                            </div>
                                            <div
                                                style={{
                                                    fontSize: 12,
                                                    color: 'var(--color-muted)',
                                                    letterSpacing: '0.14px',
                                                }}
                                            >
                                                {bean.origin} · {bean.process}
                                            </div>
                                        </div>
                                        <span
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 500,
                                                color: cfg.color,
                                                background: cfg.bg,
                                                padding: '2px 7px',
                                                borderRadius: 9999,
                                                flexShrink: 0,
                                                marginLeft: 8,
                                            }}
                                        >
                                            {cfg.label}
                                        </span>
                                    </div>

                                    {/* Stock bar */}
                                    <div style={{ marginBottom: 4 }}>
                                        <div
                                            style={{
                                                height: 4,
                                                background: 'var(--color-surface)',
                                                borderRadius: 9999,
                                                overflow: 'hidden',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    height: '100%',
                                                    width: `${pct}%`,
                                                    borderRadius: 9999,
                                                    background:
                                                        bean.status === 'Out'
                                                            ? '#dc2626'
                                                            : bean.status === 'Low'
                                                              ? '#d97706'
                                                              : 'var(--color-primary)',
                                                    transition: 'width 0.5s',
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 12,
                                            color: 'var(--color-muted)',
                                            fontFamily: 'var(--font-mono)',
                                        }}
                                    >
                                        {bean.stock.toLocaleString()}g / {bean.capacity.toLocaleString()}g
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Detail panel */}
                {selected ? (
                    <div
                        style={{
                            background: 'var(--color-main-bg)',
                            borderRadius: 16,
                            padding: '28px 32px',
                            boxShadow: 'var(--shadow-ring)',
                            height: 'fit-content',
                            position: 'relative',
                        }}
                    >
                        {/* Edit Button */}
                        <button
                            onClick={() => handleOpenAddModal('edit', selected.id, selected)}
                            style={{
                                position: 'absolute',
                                top: 24,
                                right: 24,
                                width: 36,
                                height: 36,
                                borderRadius: 10,
                                border: '1px solid rgba(0,0,0,0.06)',
                                background: 'white',
                                color: 'var(--color-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                boxShadow: 'var(--shadow-button)',
                                zIndex: 2,
                            }}
                        >
                            <Edit3 size={16} />
                        </button>

                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                justifyContent: 'space-between',
                                marginBottom: 24,
                                paddingRight: 40,
                            }}
                        >
                            <div>
                                <h2
                                    style={{
                                        fontFamily: 'var(--font-display)',
                                        fontWeight: 300,
                                        fontSize: 26,
                                        lineHeight: 1.2,
                                        color: 'var(--color-primary)',
                                        letterSpacing: '-0.3px',
                                        marginBottom: 4,
                                    }}
                                >
                                    {selected.name}
                                </h2>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <span
                                        style={{
                                            fontSize: 12,
                                            fontWeight: 500,
                                            color:
                                                processColor[selected.process as keyof typeof processColor]?.color ||
                                                'var(--color-secondary)',
                                            background:
                                                processColor[selected.process as keyof typeof processColor]?.bg ||
                                                'var(--color-surface)',
                                            padding: '3px 9px',
                                            borderRadius: 9999,
                                        }}
                                    >
                                        {selected.process}
                                    </span>
                                    <span
                                        style={{
                                            fontSize: 12,
                                            fontWeight: 500,
                                            color: 'var(--color-secondary)',
                                            background: 'var(--color-surface)',
                                            padding: '3px 9px',
                                            borderRadius: 9999,
                                            boxShadow: 'var(--shadow-inset)',
                                        }}
                                    >
                                        {selected.variety}
                                    </span>
                                </div>
                            </div>
                            {/* <div
                                style={{
                                    width: 52,
                                    height: 52,
                                    borderRadius: 12,
                                    background: 'var(--color-surface-warm-solid)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: 'var(--shadow-warm)',
                                }}
                            >
                                <Package size={22} strokeWidth={1.5} color="var(--color-secondary)" />
                            </div> */}
                        </div>

                        {/* Info grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                            {[
                                { label: 'Origin', value: selected.origin },
                                { label: 'Region', value: selected.region },
                                { label: 'Farm', value: selected.farm },
                                { label: 'Altitude', value: `${selected.altitude?.toLocaleString() || '-'} masl` },
                                { label: 'Received', value: selected.purchaseDate },
                                { label: 'Current Stock', value: `${selected.stock.toLocaleString()}g` },
                            ].map(({ label, value }) => (
                                <div key={label}>
                                    <div
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 500,
                                            color: 'var(--color-muted)',
                                            letterSpacing: '0.5px',
                                            textTransform: 'uppercase',
                                            marginBottom: 3,
                                        }}
                                    >
                                        {label}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 14,
                                            fontWeight: 500,
                                            color: 'var(--color-primary)',
                                            letterSpacing: '0.14px',
                                        }}
                                    >
                                        {value}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Tasting notes */}
                        <div
                            style={{
                                background: 'var(--color-surface-warm-solid)',
                                borderRadius: 12,
                                padding: '14px 16px',
                                marginBottom: 24,
                                boxShadow: 'var(--shadow-warm)',
                            }}
                        >
                            <div
                                style={{
                                    fontSize: 11,
                                    fontWeight: 500,
                                    color: 'var(--color-muted)',
                                    letterSpacing: '0.5px',
                                    textTransform: 'uppercase',
                                    marginBottom: 8,
                                }}
                            >
                                Tasting Notes
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {selected.tasting?.split(', ').map((note) => (
                                    <span
                                        key={note}
                                        style={{
                                            fontSize: 12,
                                            fontWeight: 500,
                                            color: 'var(--color-secondary)',
                                            background: 'rgba(255,255,255,0.7)',
                                            padding: '4px 10px',
                                            borderRadius: 9999,
                                            letterSpacing: '0.14px',
                                            boxShadow: 'var(--shadow-inset)',
                                        }}
                                    >
                                        {note}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* Stock indicator */}
                        <div style={{ marginBottom: 24 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                <span
                                    style={{
                                        fontSize: 12,
                                        fontWeight: 500,
                                        color: 'var(--color-secondary)',
                                        letterSpacing: '0.14px',
                                    }}
                                >
                                    Stock Level
                                </span>
                                <span
                                    style={{ fontSize: 12, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}
                                >
                                    {selected.stock.toLocaleString()}g / {selected.capacity.toLocaleString()}g
                                </span>
                            </div>
                            <div
                                style={{
                                    height: 6,
                                    background: 'var(--color-surface)',
                                    borderRadius: 9999,
                                    overflow: 'hidden',
                                    boxShadow: 'var(--shadow-inset)',
                                }}
                            >
                                <div
                                    style={{
                                        height: '100%',
                                        width: `${(selected.stock / selected.capacity) * 100}%`,
                                        borderRadius: 9999,
                                        background:
                                            selected.status === 'Out'
                                                ? '#dc2626'
                                                : selected.status === 'Low'
                                                  ? '#d97706'
                                                  : 'var(--color-primary)',
                                        transition: 'width 0.5s',
                                    }}
                                />
                            </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button
                                onClick={() => onNavigate?.('roast')}
                                style={{
                                    flex: 1,
                                    padding: '10px 0',
                                    borderRadius: 9999,
                                    border: 'none',
                                    background: 'var(--color-primary)',
                                    color: 'white',
                                    fontSize: 14,
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    letterSpacing: '0.14px',
                                    boxShadow: 'var(--shadow-card)',
                                }}
                            >
                                Start Roast
                            </button>
                            <button
                                onClick={() => handleOpenAddModal('restock', selected.id)}
                                style={{
                                    flex: 1,
                                    padding: '10px 0',
                                    borderRadius: 9999,
                                    border: 'none',
                                    background: 'var(--color-surface)',
                                    color: 'var(--color-secondary)',
                                    fontSize: 14,
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    letterSpacing: '0.14px',
                                    boxShadow: 'var(--shadow-inset)',
                                }}
                            >
                                Restock
                            </button>
                        </div>
                    </div>
                ) : (
                    <div
                        style={{
                            background: 'var(--color-main-bg)',
                            borderRadius: 16,
                            padding: '60px 32px',
                            boxShadow: 'var(--shadow-ring)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--color-muted)',
                            fontSize: 14,
                            letterSpacing: '0.14px',
                        }}
                    >
                        Select a bean to view details
                    </div>
                )}
            </div>
        </div>
    );
}
