import { useState } from 'react';
import { useCreateBlend, useUpdateBlend } from '@entities/blend';
import type { BlendWithComponents } from '@entities/blend';
import { useBeans } from '@entities/bean';
import { useAuthStore } from '@shared/store/auth';

type ComponentRow = { bean_id: string; ratio_pct: number };

type Props = {
  open: boolean;
  onClose: () => void;
  editing?: BlendWithComponents | null;
};

export const AddBlendModal = ({ open, onClose, editing }: Props) => {
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const { data: beans = [] } = useBeans(userId);
  const createBlend = useCreateBlend(userId);
  const updateBlend = useUpdateBlend(userId);

  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [components, setComponents] = useState<ComponentRow[]>(
    editing?.blend_components.map((c) => ({
      bean_id: c.bean_id,
      ratio_pct: Number(c.ratio_pct),
    })) ?? [{ bean_id: '', ratio_pct: 100 }],
  );

  if (!open) return null;

  const totalRatio = components.reduce((s, c) => s + c.ratio_pct, 0);
  const isValid = name.trim() && components.every((c) => c.bean_id) && totalRatio === 100;

  const addComponent = () =>
    setComponents((prev) => [...prev, { bean_id: '', ratio_pct: 0 }]);

  const removeComponent = (idx: number) =>
    setComponents((prev) => prev.filter((_, i) => i !== idx));

  const updateComponent = (idx: number, field: keyof ComponentRow, value: string | number) =>
    setComponents((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)),
    );

  const handleSubmit = async () => {
    if (!isValid) return;
    if (editing) {
      await updateBlend.mutateAsync({
        id: editing.id,
        patch: { name: name.trim(), description: description.trim() || undefined },
        components,
      });
    } else {
      await createBlend.mutateAsync({
        blend: { name: name.trim(), description: description.trim() || undefined, user_id: userId },
        components,
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl p-6 w-full max-w-lg border border-border">
        <h2 className="text-lg font-semibold mb-4">
          {editing ? '블렌드 수정' : '블렌드 추가'}
        </h2>

        <div className="space-y-3">
          <input
            className="w-full border border-border rounded-lg px-3 py-2 text-sm"
            placeholder="블렌드 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-full border border-border rounded-lg px-3 py-2 text-sm"
            placeholder="설명 (선택)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>구성 생두</span>
              <span className={totalRatio === 100 ? 'text-green-600' : 'text-red-500'}>
                합계 {totalRatio}%
              </span>
            </div>

            {components.map((comp, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <select
                  className="flex-1 border border-border rounded-lg px-2 py-1.5 text-sm"
                  value={comp.bean_id}
                  onChange={(e) => updateComponent(idx, 'bean_id', e.target.value)}
                >
                  <option value="">생두 선택</option>
                  {beans.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  className="w-20 border border-border rounded-lg px-2 py-1.5 text-sm text-right"
                  placeholder="%"
                  min={1}
                  max={100}
                  value={comp.ratio_pct}
                  onChange={(e) => updateComponent(idx, 'ratio_pct', Number(e.target.value))}
                />
                <span className="text-sm text-muted">%</span>
                {components.length > 1 && (
                  <button
                    className="text-muted hover:text-red-500 text-xs"
                    onClick={() => removeComponent(idx)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}

            <button
              className="text-sm text-primary underline"
              onClick={addComponent}
            >
              + 생두 추가
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button className="px-4 py-2 text-sm rounded-lg border border-border" onClick={onClose}>
            취소
          </button>
          <button
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white disabled:opacity-40"
            disabled={!isValid}
            onClick={handleSubmit}
          >
            {editing ? '저장' : '추가'}
          </button>
        </div>
      </div>
    </div>
  );
};
