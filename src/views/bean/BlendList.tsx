import { useState } from 'react';
import { Plus, Pencil, Trash2, GitCompare } from 'lucide-react';
import { useBlends, useDeleteBlend, type BlendWithComponents } from '@entities/blend';
import { AddBlendModal } from '@widgets/add-blend-modal';
import { useAuthStore } from '@shared/store/auth';

const ratioColor = (i: number) => {
    const colors = ['#171717', '#dc2626', '#0ea5e9', '#16a34a', '#d97706', '#8b5cf6'];
    return colors[i % colors.length];
};

export const BlendList = () => {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: blends = [], isLoading } = useBlends(userId);
    const deleteBlend = useDeleteBlend(userId);

    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<BlendWithComponents | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const selected = blends.find((b) => b.id === selectedId) ?? blends[0] ?? null;

    const handleDelete = (id: string) => {
        deleteBlend.mutate(id);
        if (selectedId === id) setSelectedId(blends.find((b) => b.id !== id)?.id ?? null);
    };

    const totalRatio = (components: BlendWithComponents['blend_components']) =>
        components.reduce((sum, c) => sum + c.ratio_pct, 0);

    if (!isLoading && blends.length === 0) {
        return (
            <div className="bg-main-bg dark:border dark:border-[#585d61] rounded-xl px-4 py-20 flex flex-col items-center justify-center gap-5 select-none">
                {/* <GitCompare size={40} strokeWidth={1.5} className="text-muted" /> */}
                <div className="text-[13px] text-muted text-center leading-relaxed">
                    등록된 블렌드가 없습니다.
                    <br />첫 번째 블렌드 레시피를 추가해 보세요.
                </div>
                <button
                    onClick={() => {
                        setEditing(null);
                        setModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-primary px-4 py-2 rounded-lg bg-surface dark:bg-surface-elevated cursor-pointer hover:bg-surface-raised transition-colors"
                >
                    <Plus size={14} strokeWidth={2} />
                    블렌드 추가
                </button>
                <AddBlendModal
                    key={editing?.id ?? 'new'}
                    open={modalOpen}
                    onClose={() => setModalOpen(false)}
                    editing={editing}
                />
            </div>
        );
    }

    return (
        <div className="grid gap-5" style={{ gridTemplateColumns: '350px 1fr' }}>
            {/* Left: Blend list */}
            <div className="flex flex-col gap-2">
                <button
                    onClick={() => {
                        setEditing(null);
                        setModalOpen(true);
                    }}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-[#E5E5E5] dark:border-[#585d61] bg-transparent text-sm text-muted cursor-pointer hover:text-secondary hover:border-black/15 dark:hover:border-[#585d61] transition-colors tracking-[0.14px] mb-1"
                >
                    <Plus size={14} strokeWidth={2} />
                    Add Blend
                </button>

                {isLoading ? (
                    <div className="flex items-center justify-center py-12 text-sm text-muted dark:text-white">
                        Loading…
                    </div>
                ) : blends.length === 0 ? null : (
                    blends.map((blend) => {
                        const isSelected = selectedId === blend.id;
                        return (
                            <div
                                key={blend.id}
                                onClick={() => setSelectedId(blend.id)}
                                className="bg-main-bg dark:border dark:border-[#585d61] rounded-lg px-4 py-3.5 cursor-pointer transition-all duration-150"
                            >
                                <div className="flex items-start justify-between mb-1.5">
                                    <span className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                        {blend.name}
                                    </span>
                                </div>
                                {blend.description && (
                                    <p className="text-[12px] text-muted tracking-[0.14px] mb-2 line-clamp-2">
                                        {blend.description}
                                    </p>
                                )}
                                <div className="flex flex-wrap gap-1.5">
                                    {blend.blend_components.map((c) => (
                                        <span
                                            key={c.id}
                                            className="text-[11px] text-muted bg-surface dark:bg-surface-elevated px-2 py-0.5 rounded-full tracking-[0.14px]"
                                        >
                                            {c.beans.name} {c.ratio_pct}%
                                        </span>
                                    ))}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Right: Blend detail */}
            {selected ? (
                <div className="bg-main-bg rounded-lg px-8 py-7 h-fit dark:border dark:border-[#585d61]">
                    <div className="flex items-start justify-between mb-6">
                        <div>
                            <h2 className="font-display font-light text-[26px] leading-[1.2] text-primary tracking-[-0.3px] mb-1">
                                {selected.name}
                            </h2>
                            {selected.description && (
                                <p className="text-sm text-secondary tracking-[0.14px] leading-normal">
                                    {selected.description}
                                </p>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setEditing(selected);
                                    setModalOpen(true);
                                }}
                                className="w-9 h-9 rounded-[10px] border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer"
                                title="Edit"
                            >
                                <Pencil size={14} strokeWidth={2} />
                            </button>
                            <button
                                onClick={() => handleDelete(selected.id)}
                                className="w-9 h-9 rounded-[10px] border-none bg-surface dark:bg-surface-elevated flex items-center justify-center cursor-pointer"
                                title="Delete"
                                style={{ color: '#dc2626' }}
                            >
                                <Trash2 size={14} strokeWidth={2} />
                            </button>
                        </div>
                    </div>

                    {/* Component breakdown */}
                    <div className="bg-surface dark:bg-surface-elevated rounded-lg px-4.5 py-4 mb-6">
                        <div className="text-[12px] font-semibold text-secondary mb-3 tracking-[0.14px]">
                            Component Beans
                        </div>
                        <div className="space-y-2.5">
                            {selected.blend_components.map((c, i) => (
                                <div key={c.id}>
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                            {c.beans.name}
                                        </span>
                                        <span className="text-[12px] font-mono font-semibold text-secondary">
                                            {c.ratio_pct}%
                                        </span>
                                    </div>
                                    <div className="h-1.5 bg-white/70 dark:bg-white/8 rounded-full overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all"
                                            style={{
                                                width: `${(c.ratio_pct / totalRatio(selected.blend_components)) * 100}%`,
                                                backgroundColor: ratioColor(i),
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Summary bar */}
                    <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-surface-warm-solid dark:bg-[#1a1e23]">
                        <span className="text-[12px] text-muted tracking-[0.14px]">
                            {selected.blend_components.length} bean{selected.blend_components.length !== 1 ? 's' : ''} ·{' '}
                            {totalRatio(selected.blend_components)}% total
                        </span>
                    </div>
                </div>
            ) : blends.length > 0 ? (
                <div className="bg-main-bg dark:border dark:border-[#585d61] rounded-lg py-15 px-8 flex items-center justify-center text-sm text-muted tracking-[0.14px]">
                    Select a blend to view details
                </div>
            ) : null}

            <AddBlendModal
                key={editing?.id ?? 'new'}
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                editing={editing}
            />
        </div>
    );
};
