import { useBeanStockSummaries } from '@entities/bean-stock-event';
import { type BlendWithComponents, useBlends, useDeleteBlend } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { blendRoastableByBlends, EMPTY_BLEND_ROASTABLE } from '@shared/lib/blend-stock';
import { useMemo, useState } from 'react';

export const useBlendListState = () => {
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: blends = [], isLoading } = useBlends(userId);
    const { data: stockSummaries = {} } = useBeanStockSummaries(userId);
    const deleteBlend = useDeleteBlend(userId);

    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<BlendWithComponents | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const selected = blends.find((b) => b.id === selectedId) ?? blends[0] ?? null;

    const roastableByBlendId = useMemo(() => blendRoastableByBlends(blends, stockSummaries), [blends, stockSummaries]);

    const roastable = selected ? (roastableByBlendId[selected.id] ?? EMPTY_BLEND_ROASTABLE) : EMPTY_BLEND_ROASTABLE;

    const openCreate = () => {
        setEditing(null);
        setModalOpen(true);
    };

    const openEdit = (blend: BlendWithComponents) => {
        setEditing(blend);
        setModalOpen(true);
    };

    const closeModal = () => setModalOpen(false);

    const handleDelete = (id: string) => {
        deleteBlend.mutate(id);
        if (selectedId === id) setSelectedId(blends.find((b) => b.id !== id)?.id ?? null);
    };

    return {
        blends,
        isLoading,
        selected,
        selectedId,
        setSelectedId,
        modalOpen,
        editing,
        roastableByBlendId,
        roastable,
        stockSummaries,
        openCreate,
        openEdit,
        closeModal,
        handleDelete,
    };
};
