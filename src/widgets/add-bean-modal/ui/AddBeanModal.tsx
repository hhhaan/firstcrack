import { useEffect, useState } from 'react';
import { PackagePlus, X, Info, Scale, MapPin, Tag, Search, Check, Edit3 } from 'lucide-react';
import ModalShell from '../../../shared/ui/modal-shell/ModalShell';

interface Bean {
  id: number;
  name: string;
  origin: string;
  process: string;
  stock: number;
  capacity: number;
  region?: string;
  farm?: string;
  variety?: string;
  altitude?: number;
  tasting?: string;
}

interface AddBeanModalProps {
  open: boolean;
  onClose: () => void;
  existingBeans: Bean[];
  initialTab?: 'new' | 'restock' | 'edit';
  initialBeanId?: number | null;
  initialData?: Bean | null;
}

export default function AddBeanModal({ 
  open, 
  onClose, 
  existingBeans,
  initialTab = 'new',
  initialBeanId = null,
  initialData = null
}: AddBeanModalProps) {
  const [tab, setTab] = useState<'new' | 'restock' | 'edit'>(initialTab);
  const [selectedBeanId, setSelectedBeanId] = useState<number | null>(initialBeanId);
  const [restockAmount, setRestockAmount] = useState('');
  
  const [formData, setFormData] = useState({
    name: '',
    origin: '',
    region: '',
    farm: '',
    process: 'Washed',
    variety: '',
    altitude: '',
    stock: '',
    capacity: '5000',
    tastingNotes: '',
  });

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setSelectedBeanId(initialBeanId);
      setRestockAmount('');
      
      if (initialData && (initialTab === 'edit' || initialTab === 'new')) {
        setFormData({
          name: initialData.name || '',
          origin: initialData.origin || '',
          region: initialData.region || '',
          farm: initialData.farm || '',
          process: initialData.process || 'Washed',
          variety: initialData.variety || '',
          altitude: initialData.altitude?.toString() || '',
          stock: initialData.stock?.toString() || '',
          capacity: initialData.capacity?.toString() || '5000',
          tastingNotes: initialData.tasting || '',
        });
      } else if (!initialData) {
        setFormData({
          name: '',
          origin: '',
          region: '',
          farm: '',
          process: 'Washed',
          variety: '',
          altitude: '',
          stock: '',
          capacity: '5000',
          tastingNotes: '',
        });
      }
    }
  }, [open, initialTab, initialBeanId, initialData]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid rgba(0,0,0,0.08)',
    background: 'rgba(255,255,255,0.8)',
    boxShadow: 'var(--shadow-inset)',
    fontSize: 14,
    color: 'var(--color-primary)',
    outline: 'none',
    transition: 'all 0.2s',
  };

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-muted)',
    marginBottom: 8,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '12px',
    borderRadius: 12,
    border: 'none',
    background: active ? 'white' : 'transparent',
    color: active ? 'var(--color-primary)' : 'var(--color-muted)',
    fontSize: 14,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: active ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
  });

  return (
    <ModalShell
      onClose={onClose}
      labelledBy="add-bean-modal-title"
      contentStyle={{
        width: 'min(640px, 100%)',
        maxHeight: 'min(860px, calc(100vh - 64px))',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 28,
        background: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: '0 32px 80px rgba(22, 18, 12, 0.25)',
        border: '1px solid rgba(255,255,255,1)',
        overflow: 'hidden',
      }}
    >
      {/* Sticky Header */}
      <div style={{ 
        flexShrink: 0,
        background: 'rgba(255,255,255,0.6)', 
        backdropFilter: 'blur(8px)', 
        zIndex: 10, 
        borderBottom: '1px solid rgba(0,0,0,0.04)' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 32px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
            }}>
              {tab === 'edit' ? <Edit3 size={22} /> : <PackagePlus size={22} />}
            </div>
            <div>
              <h2 id="add-bean-modal-title" style={{
                fontFamily: 'var(--font-display)',
                fontSize: 24,
                fontWeight: 400,
                color: 'var(--color-primary)',
                letterSpacing: '-0.02em',
                margin: 0,
              }}>
                {tab === 'new' ? 'New Bean Lot' : tab === 'edit' ? 'Edit Bean Details' : 'Restock Existing'}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              border: 'none',
              background: 'var(--color-surface)',
              color: 'var(--color-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        {/* Tabs - Only show if not in Edit mode */}
        {tab !== 'edit' && (
          <div style={{ padding: '0 32px 20px' }}>
            <div style={{
              display: 'flex',
              background: 'var(--color-surface)',
              padding: 4,
              borderRadius: 16,
              boxShadow: 'var(--shadow-inset)',
            }}>
              <button onClick={() => setTab('new')} style={tabStyle(tab === 'new')}>New Arrival</button>
              <button onClick={() => setTab('restock')} style={tabStyle(tab === 'restock')}>Restock Existing</button>
            </div>
          </div>
        )}
      </div>

      {/* Scrollable Body */}
      <div style={{ padding: '32px', overflowY: 'auto', flex: 1 }}>
        {tab === 'new' || tab === 'edit' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* General Info */}
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}><Info size={14} /> Lot Name</label>
              <input
                style={inputStyle}
                placeholder="e.g. Ethiopia Yirgacheffe G1"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div>
              <label style={labelStyle}><MapPin size={14} /> Origin Country</label>
              <input
                style={inputStyle}
                placeholder="e.g. Ethiopia"
                value={formData.origin}
                onChange={e => setFormData({ ...formData, origin: e.target.value })}
              />
            </div>

            <div>
              <label style={labelStyle}><MapPin size={14} /> Region / Farm</label>
              <input
                style={inputStyle}
                placeholder="e.g. Guji Zone / Shakiso"
                value={formData.region}
                onChange={e => setFormData({ ...formData, region: e.target.value })}
              />
            </div>

            <div>
              <label style={labelStyle}><Tag size={14} /> Process</label>
              <div style={{ position: 'relative' }}>
                <select
                  style={{ ...inputStyle, appearance: 'none' }}
                  value={formData.process}
                  onChange={e => setFormData({ ...formData, process: e.target.value })}
                >
                  <option value="Washed">Washed</option>
                  <option value="Natural">Natural</option>
                  <option value="Honey">Honey</option>
                  <option value="Anaerobic">Anaerobic</option>
                  <option value="Experimental">Experimental</option>
                </select>
                <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.5 }}>
                  <Tag size={14} />
                </div>
              </div>
            </div>

            <div>
              <label style={labelStyle}><Tag size={14} /> Variety</label>
              <input
                style={inputStyle}
                placeholder="e.g. Heirloom, SL28"
                value={formData.variety}
                onChange={e => setFormData({ ...formData, variety: e.target.value })}
              />
            </div>

            <div>
              <label style={labelStyle}><Scale size={14} /> {tab === 'edit' ? 'Current Stock (g)' : 'Initial Stock (g)'}</label>
              <input
                type="number"
                style={inputStyle}
                placeholder="5000"
                value={formData.stock}
                onChange={e => setFormData({ ...formData, stock: e.target.value })}
              />
            </div>

            <div>
              <label style={labelStyle}><Scale size={14} /> Bag Capacity (g)</label>
              <input
                type="number"
                style={inputStyle}
                placeholder="5000"
                value={formData.capacity}
                onChange={e => setFormData({ ...formData, capacity: e.target.value })}
              />
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}><Info size={14} /> Tasting Notes</label>
              <textarea
                style={{ ...inputStyle, minHeight: 100, resize: 'none' }}
                placeholder="e.g. Jasmine, Blueberry, Milk Chocolate"
                value={formData.tastingNotes}
                onChange={e => setFormData({ ...formData, tastingNotes: e.target.value })}
              />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <label style={labelStyle}><Search size={14} /> Select Bean to Restock</label>
              <div style={{ 
                display: 'grid', 
                gap: 10, 
                padding: '4px',
              }}>
                {existingBeans.map(bean => (
                  <div
                    key={bean.id}
                    onClick={() => setSelectedBeanId(bean.id)}
                    style={{
                      padding: '14px 18px',
                      borderRadius: 16,
                      background: selectedBeanId === bean.id ? 'var(--color-primary)' : 'rgba(255,255,255,0.7)',
                      color: selectedBeanId === bean.id ? 'white' : 'var(--color-primary)',
                      border: '1px solid rgba(0,0,0,0.06)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.2s',
                      boxShadow: selectedBeanId === bean.id ? '0 8px 20px rgba(0,0,0,0.12)' : 'var(--shadow-ring)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{bean.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{bean.origin} · {bean.process}</div>
                    </div>
                    {selectedBeanId === bean.id ? (
                      <Check size={18} strokeWidth={2.5} />
                    ) : (
                      <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', opacity: 0.6 }}>
                        {bean.stock.toLocaleString()}g
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ 
              background: 'var(--color-surface-warm-solid)', 
              padding: '24px', 
              borderRadius: 20,
              boxShadow: 'var(--shadow-warm)',
              opacity: selectedBeanId ? 1 : 0.5,
              pointerEvents: selectedBeanId ? 'auto' : 'none',
              transition: 'opacity 0.2s',
            }}>
              <label style={labelStyle}><Scale size={14} /> Weight to Add (g)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input
                  type="number"
                  style={{ ...inputStyle, fontSize: 24, fontWeight: 600, padding: '16px' }}
                  placeholder="0"
                  value={restockAmount}
                  onChange={e => setRestockAmount(e.target.value)}
                />
                <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--color-muted)' }}>grams</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sticky Footer */}
      <div style={{ 
        padding: '20px 32px 32px', 
        background: 'rgba(255,255,255,0.8)', 
        backdropFilter: 'blur(8px)', 
        borderTop: '1px solid rgba(0,0,0,0.04)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: 16,
              border: 'none',
              background: 'var(--color-surface)',
              color: 'var(--color-secondary)',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: 'var(--shadow-inset)',
            }}
          >
            Cancel
          </button>
          <button
            disabled={tab === 'restock' && (!selectedBeanId || !restockAmount)}
            onClick={() => {
              onClose();
            }}
            style={{
              flex: 2,
              padding: '14px',
              borderRadius: 16,
              border: 'none',
              background: 'var(--color-primary)',
              color: 'white',
              fontSize: 15,
              fontWeight: 600,
              cursor: (tab === 'restock' && (!selectedBeanId || !restockAmount)) ? 'not-allowed' : 'pointer',
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
              opacity: (tab === 'restock' && (!selectedBeanId || !restockAmount)) ? 0.6 : 1,
            }}
          >
            {tab === 'new' ? 'Create Bean Lot' : tab === 'edit' ? 'Update Bean Details' : 'Confirm Restock'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
