import { useState } from 'react';
import { useBlends, useDeleteBlend } from '@entities/blend';
import type { BlendWithComponents } from '@entities/blend';
import { AddBlendModal } from '@widgets/add-blend-modal';
import { useAuthStore } from '@shared/store/auth';

export const BlendList = () => {
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const { data: blends = [], isLoading } = useBlends(userId);
  const deleteBlend = useDeleteBlend(userId);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BlendWithComponents | null>(null);

  if (isLoading) return <div className="p-4 text-sm text-gray-400">불러오는 중...</div>;

  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-gray-700">블렌드 레시피</h2>
        <button
          className="text-sm bg-(--color-primary) text-white px-3 py-1.5 rounded-lg"
          onClick={() => { setEditing(null); setModalOpen(true); }}
        >
          + 블렌드 추가
        </button>
      </div>

      {blends.length === 0 && (
        <p className="text-sm text-gray-400">블렌드 레시피가 없습니다.</p>
      )}

      {blends.map((blend) => (
        <div key={blend.id} className="border border-[#E5E5E5] rounded-xl p-4 space-y-2">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-medium text-sm">{blend.name}</p>
              {blend.description && (
                <p className="text-xs text-gray-400">{blend.description}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                className="text-xs text-gray-400 hover:text-gray-700"
                onClick={() => { setEditing(blend); setModalOpen(true); }}
              >
                수정
              </button>
              <button
                className="text-xs text-red-400 hover:text-red-600"
                onClick={() => deleteBlend.mutate(blend.id)}
              >
                삭제
              </button>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {blend.blend_components.map((c) => (
              <span
                key={c.id}
                className="text-xs bg-gray-100 rounded-full px-2 py-0.5"
              >
                {c.beans.name} {c.ratio_pct}%
              </span>
            ))}
          </div>
        </div>
      ))}

      <AddBlendModal
        key={editing?.id ?? 'new'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
      />
    </div>
  );
};
