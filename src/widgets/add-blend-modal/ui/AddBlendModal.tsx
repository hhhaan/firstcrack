import { useEffect, useState } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
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

const inputCls =
  'w-full px-3.5 py-3 rounded-xl border border-black/8 bg-white/80 shadow-(--shadow-inset) text-sm text-primary outline-none transition-all';

const labelCls = 'flex items-center gap-1.5 text-xs font-semibold text-muted mb-2 tracking-[0.02em] uppercase';

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

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

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
    <ModalShell
      onClose={onClose}
      labelledBy="add-blend-modal-title"
      contentClassName="max-w-[560px] w-full max-h-[min(720px,calc(100vh-64px))] flex flex-col rounded-[28px] bg-[rgba(255,255,255,0.96)] backdrop-[blur(20px)_saturate(180%)] shadow-[0_32px_80px_rgba(22,18,12,0.25)] border border-white overflow-hidden"
    >
      {/* Header */}
      <div className="shrink-0 bg-white/60 backdrop-blur-sm z-10 border-b border-black/4">
        <div className="flex items-center justify-between px-8 pt-6 pb-5">
          <h2
            id="add-blend-modal-title"
            className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0"
          >
            {editing ? '블렌드 수정' : '블렌드 추가'}
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl border-none bg-surface text-muted flex items-center justify-center cursor-pointer transition-all duration-200"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="p-8 overflow-y-auto flex-1 space-y-4">
        {/* Name */}
        <div>
          <label className={labelCls}>블렌드 이름</label>
          <input
            className={inputCls}
            placeholder="블렌드 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Description */}
        <div>
          <label className={labelCls}>설명 (선택)</label>
          <input
            className={inputCls}
            placeholder="설명 (선택)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Components */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className={labelCls + ' mb-0'}>구성 생두</label>
            <span className={`text-xs font-semibold ${totalRatio === 100 ? 'text-green-600' : 'text-red-500'}`}>
              합계 {totalRatio}%
            </span>
          </div>

          <div className="space-y-2">
            {components.map((comp, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <div className="relative flex-1">
                  <select
                    className="w-full px-3 py-2.5 rounded-xl border border-black/8 bg-white/80 shadow-(--shadow-inset) text-sm text-primary outline-none transition-all appearance-none cursor-pointer"
                    value={comp.bean_id}
                    onChange={(e) => updateComponent(idx, 'bean_id', e.target.value)}
                    style={{ paddingRight: '2rem' }}
                  >
                    <option value="">생두 선택</option>
                    {beans.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    strokeWidth={2}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                  />
                </div>
                <input
                  type="number"
                  className="w-20 px-3 py-2.5 rounded-xl border border-black/8 bg-white/80 shadow-(--shadow-inset) text-sm text-primary text-right outline-none transition-all"
                  placeholder="%"
                  min={1}
                  max={100}
                  value={comp.ratio_pct}
                  onChange={(e) => updateComponent(idx, 'ratio_pct', Number(e.target.value))}
                />
                <span className="text-sm text-muted">%</span>
                {components.length > 1 && (
                  <button
                    type="button"
                    className="w-8 h-8 rounded-xl border-none bg-surface text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-red-500"
                    onClick={() => removeComponent(idx)}
                  >
                    <X size={14} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="mt-3 text-sm text-primary font-medium underline cursor-pointer"
            onClick={addComponent}
          >
            + 생두 추가
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="px-8 pt-5 pb-8 bg-white/80 backdrop-blur-sm border-t border-black/4 shrink-0">
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3.5 rounded-2xl border-none bg-surface text-secondary text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
          >
            취소
          </button>
          <button
            disabled={!isValid}
            onClick={handleSubmit}
            className="flex-1 py-3.5 rounded-2xl border-none bg-primary text-white text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {editing ? '저장' : '추가'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
