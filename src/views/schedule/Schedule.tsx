import { useState } from 'react';
import {
    Plus,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    ChevronUp,
    FileDown,
    Share2,
    RefreshCw,
    Package,
} from 'lucide-react';
import { AddBatchModal, type NewBatchData } from '@widgets/add-batch-modal';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Batch {
    id: string;
    time: string;
    beanName: string;
    beanType: string;
    profile: string;
    targetRoasted: number;
    batches: number;
    greenNeeded: number;
    yield: number;
    batchSize: number;
    status: 'Planned' | 'In Progress' | 'Completed';
    greenLot: string;
    linkedOrders?: string;
    notes?: string;
}

interface StockItem {
    bean: string;
    current: number;
    total: number;
    warning?: boolean;
}

type MachineId = 'machine1' | 'machine2';

// ── Mock data ─────────────────────────────────────────────────────────────────

const INITIAL_MACHINES: Record<MachineId, Batch[]> = {
    machine1: [
        {
            id: 'b1',
            time: '09:00',
            beanName: 'Colombia Excelso',
            beanType: 'Single Origin',
            profile: 'City+ Omni',
            targetRoasted: 120,
            batches: 4,
            greenNeeded: 147.0,
            yield: 81.6,
            batchSize: 25,
            status: 'Planned',
            greenLot: 'COL-2401 (312kg)',
            linkedOrders: 'ORD-8923, ORD-8924, ORD-8925',
            notes: '고객사 에스프레소 블렌드용',
        },
        {
            id: 'b2',
            time: '10:45',
            beanName: 'Brazil Cerrado Blend',
            beanType: 'Pre-roast',
            profile: 'Medium Roast',
            targetRoasted: 75,
            batches: 3,
            greenNeeded: 91.5,
            yield: 82.0,
            batchSize: 25,
            status: 'Planned',
            greenLot: 'BRA-2305 (120kg) + BRA-2308 (50kg)',
        },
        {
            id: 'b3',
            time: '13:00',
            beanName: 'Ethiopia Yirgacheffe',
            beanType: 'Single Origin',
            profile: 'Light Filter',
            targetRoasted: 50,
            batches: 2,
            greenNeeded: 61.0,
            yield: 82.0,
            batchSize: 25,
            status: 'Planned',
            greenLot: 'ETH-2412 (80kg)',
        },
    ],
    machine2: [
        {
            id: 'b4',
            time: '09:30',
            beanName: 'Kenya AA',
            beanType: 'Single Origin',
            profile: 'Light Filter',
            targetRoasted: 36,
            batches: 3,
            greenNeeded: 43.9,
            yield: 82.0,
            batchSize: 12,
            status: 'Planned',
            greenLot: 'KEN-2408 (60kg)',
        },
    ],
};

const STOCK_ITEMS: StockItem[] = [
    { bean: 'Colombia Excelso', current: 312, total: 450 },
    { bean: 'Ethiopia Yirgacheffe', current: 80, total: 150, warning: true },
    { bean: 'Brazil Cerrado Blend', current: 87, total: 200 },
    { bean: 'Kenya AA', current: 60, total: 100 },
];

// ── Sub-components ────────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: Batch['status'] }) => {
    const styles: Record<Batch['status'], string> = {
        Planned: 'bg-surface text-muted border border-border',
        'In Progress': 'bg-amber-50 text-amber-700 border border-amber-200',
        Completed: 'bg-green-50 text-green-700 border border-green-200',
    };
    return (
        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-md ${styles[status]}`}>
            {status}
        </span>
    );
};

const BatchCard = ({
    batch,
    index,
    total,
    onMove,
}: {
    batch: Batch;
    index: number;
    total: number;
    onMove: (direction: 'up' | 'down') => void;
}) => (
    <div className="flex gap-2">
        {/* Order controls */}
        <div className="flex flex-col gap-1 pt-1 shrink-0">
            <button
                onClick={() => onMove('up')}
                disabled={index === 0}
                className="w-6 h-6 rounded-md flex items-center justify-center border-none bg-surface text-muted cursor-pointer shadow-(--shadow-inset) hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
                <ChevronUp size={13} strokeWidth={2} />
            </button>
            <button
                onClick={() => onMove('down')}
                disabled={index === total - 1}
                className="w-6 h-6 rounded-md flex items-center justify-center border-none bg-surface text-muted cursor-pointer shadow-(--shadow-inset) hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
                <ChevronDown size={13} strokeWidth={2} />
            </button>
        </div>

        {/* Card */}
        <div className="flex-1 border border-border rounded-xl p-4 bg-main-bg hover:border-border-strong transition-colors duration-150">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Package size={14} strokeWidth={1.5} color="var(--color-muted)" className="shrink-0 mt-[1px]" />
                    <span className="text-[14px] font-semibold text-primary">{batch.beanName}</span>
                    <span className="text-[12px] text-muted">({batch.beanType})</span>
                </div>
                <StatusBadge status={batch.status} />
            </div>
            <div className="mt-2.5 pl-[22px] space-y-1.5">
                <div className="text-[12px] text-secondary">
                    Profile: <span className="font-medium text-primary">{batch.profile}</span>
                </div>
                <div className="text-[12px] text-secondary">
                    목표 Roasted:{' '}
                    <span className="font-medium text-primary">{batch.targetRoasted} kg</span>
                    <span className="text-muted ml-1">({batch.batches} 배치)</span>
                </div>
                <div className="text-[12px] text-secondary flex flex-wrap items-center gap-x-2.5">
                    <span>
                        Green 필요: <span className="font-medium text-primary">{batch.greenNeeded} kg</span>
                    </span>
                    <span className="text-border-subtle">│</span>
                    <span>Yield: {batch.yield}%</span>
                    <span className="text-border-subtle">│</span>
                    <span>Batch size: {batch.batchSize}kg</span>
                </div>
                <div className="text-[12px] text-secondary flex flex-wrap items-center gap-x-2.5">
                    <span>
                        Green Lot: <span className="font-medium text-primary">{batch.greenLot}</span>
                    </span>
                    {batch.linkedOrders && (
                        <>
                            <span className="text-border-subtle">│</span>
                            <span>
                                연동 주문:{' '}
                                <span className="font-medium text-primary">{batch.linkedOrders}</span>
                            </span>
                        </>
                    )}
                </div>
                {batch.notes && <div className="text-[12px] text-muted">Notes: {batch.notes}</div>}
            </div>
        </div>
    </div>
);

const MachineSection = ({
    id,
    name,
    description,
    batches,
    onMove,
}: {
    id: MachineId;
    name: string;
    description: string;
    batches: Batch[];
    onMove: (machineId: MachineId, index: number, direction: 'up' | 'down') => void;
}) => (
    <section>
        <div className="flex items-center gap-3 mb-4">
            <span className="text-[12px] font-semibold text-muted uppercase tracking-[0.6px]">{name}</span>
            <span className="text-[12px] text-muted">{description}</span>
            <div className="flex-1 h-px bg-border-subtle" />
        </div>
        <div className="space-y-3">
            {batches.map((batch, index) => (
                <div key={batch.id}>
                    <div className="text-[12px] font-medium text-muted mb-2 pl-8 tabular-nums">
                        {batch.time}
                    </div>
                    <BatchCard
                        batch={batch}
                        index={index}
                        total={batches.length}
                        onMove={(dir) => onMove(id, index, dir)}
                    />
                </div>
            ))}
            {batches.length === 0 && (
                <div className="border border-dashed border-border rounded-xl px-4 py-3 text-[12px] text-muted text-center select-none">
                    배치 없음
                </div>
            )}
        </div>
    </section>
);

const StockBar = ({ item }: { item: StockItem }) => {
    const pct = Math.round((item.current / item.total) * 100);
    return (
        <div>
            <div className="flex justify-between items-baseline mb-1.5">
                <span className="text-[12px] font-medium text-primary truncate max-w-[160px]">
                    {item.bean}
                </span>
                <span className={`text-[11px] font-medium ${item.warning ? 'text-amber-600' : 'text-muted'}`}>
                    {item.current} / {item.total} kg
                </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-300 ${item.warning ? 'bg-amber-400' : 'bg-surface-warm-solid'}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <div className={`text-[11px] mt-1 ${item.warning ? 'text-amber-600 font-medium' : 'text-muted'}`}>
                {pct}%{item.warning ? '  ⚠ 부족 경고' : ''}
            </div>
        </div>
    );
};

// ── Main view ─────────────────────────────────────────────────────────────────

type ViewMode = '일간' | '주간' | '월간';

const NAV_DATES = [
    { label: '5/19', offset: -1 },
    { label: '5/20', offset: 0 },
    { label: '5/21', offset: 1 },
];

const MACHINE_META: Record<MachineId, { name: string; description: string }> = {
    machine1: { name: '1호기', description: 'Probat P25 — 25kg' },
    machine2: { name: '2호기', description: '12kg' },
};

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const Schedule = () => {
    const [viewMode, setViewMode] = useState<ViewMode>('일간');
    const [selectedDateOffset, setSelectedDateOffset] = useState(0);
    const [scheduleMachines, setScheduleMachines] = useState<Record<MachineId, Batch[]>>(INITIAL_MACHINES);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const handleMove = (machineId: MachineId, index: number, direction: 'up' | 'down') => {
        setScheduleMachines((prev) => {
            const batches = [...prev[machineId]];
            const swapWith = direction === 'up' ? index - 1 : index + 1;
            [batches[index], batches[swapWith]] = [batches[swapWith], batches[index]];
            return { ...prev, [machineId]: batches };
        });
    };

    const handleAddBatch = (data: NewBatchData) => {
        const newBatch: Batch = {
            id: uid(),
            time: '',
            beanName: data.beanName || data.batchType,
            beanType: data.batchType,
            profile: data.profileName,
            targetRoasted: data.targetRoasted,
            batches: data.batchCount,
            greenNeeded: data.greenNeeded,
            yield: data.yieldPct,
            batchSize: data.batchSize,
            status: 'Planned',
            greenLot: data.greenLot,
            notes: data.notes || undefined,
        };
        // Add to the first machine for now; if a matching machine key exists use it
        const targetKey = (Object.keys(scheduleMachines) as MachineId[]).find(
            (k) => scheduleMachines[k] !== undefined,
        ) ?? 'machine1';
        setScheduleMachines((prev) => ({
            ...prev,
            [targetKey]: [...prev[targetKey], newBatch],
        }));
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Date / mode nav */}
            <div className="shrink-0 border-b border-border-subtle bg-main-bg px-8 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setSelectedDateOffset((o) => o - 1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border-none bg-surface text-muted cursor-pointer shadow-(--shadow-inset) hover:text-primary transition-colors"
                    >
                        <ChevronLeft size={14} strokeWidth={2} />
                    </button>
                    <div className="flex items-center gap-1">
                        {NAV_DATES.map(({ label, offset }) => {
                            const isSelected = selectedDateOffset === offset;
                            return (
                                <button
                                    key={label}
                                    onClick={() => setSelectedDateOffset(offset)}
                                    className={`text-[13px] font-medium px-3 py-1.5 rounded-lg border-none cursor-pointer transition-colors duration-150 ${
                                        isSelected
                                            ? 'bg-surface text-primary shadow-(--shadow-inset)'
                                            : 'bg-transparent text-muted hover:text-secondary'
                                    }`}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                    <button
                        onClick={() => setSelectedDateOffset((o) => o + 1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border-none bg-surface text-muted cursor-pointer shadow-(--shadow-inset) hover:text-primary transition-colors"
                    >
                        <ChevronRight size={14} strokeWidth={2} />
                    </button>
                    <span className="ml-2 text-[13px] font-semibold text-primary">
                        2026년 5월 20일 (수)
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    {(['일간', '주간', '월간'] as ViewMode[]).map((mode) => {
                        const isActive = viewMode === mode;
                        return (
                            <button
                                key={mode}
                                onClick={() => setViewMode(mode)}
                                className={`text-[13px] font-medium px-3 py-1.5 rounded-lg border-none cursor-pointer transition-colors duration-150 flex items-center gap-1 ${
                                    isActive
                                        ? 'bg-surface text-primary shadow-(--shadow-inset)'
                                        : 'bg-transparent text-muted hover:text-secondary'
                                }`}
                            >
                                {mode}
                                {isActive && mode === '일간' && <ChevronDown size={12} strokeWidth={2} />}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Toolbar */}
            <div className="shrink-0 border-b border-border-subtle bg-main-bg px-8 py-2.5 flex items-center gap-2 flex-wrap">
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-primary px-3 py-1.5 rounded-lg border border-border bg-surface shadow-(--shadow-inset) cursor-pointer hover:bg-surface-raised transition-colors"
                >
                    <Plus size={13} strokeWidth={2} />
                    새 배치 추가
                </button>
                <button className="flex items-center gap-1.5 text-[13px] font-medium text-secondary px-3 py-1.5 rounded-lg border border-border bg-surface shadow-(--shadow-inset) cursor-pointer hover:bg-surface-raised transition-colors">
                    Order to Roast로 자동 생성
                    <ChevronDown size={12} strokeWidth={2} />
                </button>
                <div className="flex-1" />
                <button className="flex items-center gap-1.5 text-[12px] text-muted px-2.5 py-1.5 rounded-lg border-none bg-transparent cursor-pointer hover:text-secondary transition-colors">
                    <FileDown size={13} strokeWidth={1.5} />
                    Export CSV
                </button>
                <button className="flex items-center gap-1.5 text-[12px] text-muted px-2.5 py-1.5 rounded-lg border-none bg-transparent cursor-pointer hover:text-secondary transition-colors">
                    <Share2 size={13} strokeWidth={1.5} />
                    Publish to RI
                </button>
                <button className="flex items-center gap-1.5 text-[12px] text-muted px-2.5 py-1.5 rounded-lg border-none bg-transparent cursor-pointer hover:text-secondary transition-colors">
                    <RefreshCw size={13} strokeWidth={1.5} />
                    전체 재계산
                </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-8">
                {(Object.keys(scheduleMachines) as MachineId[]).map((machineId) => (
                    <MachineSection
                        key={machineId}
                        id={machineId}
                        name={MACHINE_META[machineId].name}
                        description={MACHINE_META[machineId].description}
                        batches={scheduleMachines[machineId]}
                        onMove={handleMove}
                    />
                ))}

                {/* Green Stock Projection */}
                <section>
                    <div className="flex items-center gap-3 mb-4">
                        <span className="text-[12px] font-semibold text-muted uppercase tracking-[0.6px]">
                            Green Stock Projection
                        </span>
                        <span className="text-[11px] text-muted">(실시간)</span>
                        <div className="flex-1 h-px bg-border-subtle" />
                    </div>
                    <div className="border border-border rounded-xl p-5 bg-main-bg">
                        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                            {STOCK_ITEMS.map((item) => (
                                <StockBar key={item.bean} item={item} />
                            ))}
                        </div>
                    </div>
                </section>
            </div>

            <AddBatchModal
                open={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onAdd={handleAddBatch}
            />
        </div>
    );
};
