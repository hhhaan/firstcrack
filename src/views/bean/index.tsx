import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAuthStore } from '../../shared/store/auth'
import { useBeans } from '../../entities/bean/queries'
import { getStatus } from '../../entities/bean/lib'
import { BeanList } from '../../widgets/bean-list/ui/BeanList'
import { BeanDetail } from '../../widgets/bean-detail/ui/BeanDetail'
import { AddBeanModal } from '../../widgets/add-bean-modal/ui/AddBeanModal'
import type { Bean } from '../../shared/types/database.types'
import type { View } from '../../shared/types/view'

interface BeansProps {
    onNavigate?: (view: View) => void
}

export const Beans = ({ onNavigate }: BeansProps) => {
    const userId = useAuthStore((s) => s.user?.id ?? '')
    const { data: beans = [], isLoading } = useBeans(userId)

    const [search, setSearch] = useState('')
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [isAddModalOpen, setIsAddModalOpen] = useState(false)
    const [modalConfig, setModalConfig] = useState<{
        tab: 'new' | 'restock' | 'edit'
        beanId: string | null
        initialData?: Bean | null
    }>({ tab: 'new', beanId: null })

    const openModal = (tab: 'new' | 'restock' | 'edit', beanId: string | null = null, initialData: Bean | null = null) => {
        setModalConfig({ tab, beanId, initialData })
        setIsAddModalOpen(true)
    }

    const selected = beans.find((b) => b.id === selectedId) ?? beans[0] ?? null

    const stats = beans.reduce(
        (acc, b) => {
            const s = getStatus(b)
            if (s === 'Low') { acc.active++; acc.low++ }
            else if (s === 'Out') { acc.out++ }
            else { acc.active++ }
            return acc
        },
        { active: 0, low: 0, out: 0 },
    )

    return (
        <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
            <AddBeanModal
                open={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                userId={userId}
                existingBeans={beans}
                initialTab={modalConfig.tab}
                initialBeanId={modalConfig.beanId}
                initialData={modalConfig.initialData}
                onSuccess={(bean) => { if (bean) setSelectedId(bean.id) }}
            />

            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
                <div>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 32, lineHeight: 1.13, color: 'var(--color-primary)', letterSpacing: '-0.4px', marginBottom: 4 }}>
                        Bean Inventory
                    </h1>
                    <p style={{ fontSize: 14, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
                        {isLoading ? (
                            <span style={{ display: 'inline-block', width: 180, height: 14, borderRadius: 6, background: 'var(--color-surface)', verticalAlign: 'middle' }} className="animate-pulse" />
                        ) : (
                            <>{stats.active} active lots · {stats.low} low stock · {stats.out} out of stock</>
                        )}
                    </p>
                </div>
                <button
                    onClick={() => openModal('new')}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 9999, border: 'none', background: 'var(--color-primary)', color: 'white', fontSize: 14, fontWeight: 500, cursor: 'pointer', boxShadow: 'var(--shadow-card)', letterSpacing: '0.14px' }}
                >
                    <Plus size={15} strokeWidth={2.5} />
                    Add Bean Lot
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20 }}>
                <BeanList
                    beans={beans}
                    isLoading={isLoading}
                    selectedId={selected?.id ?? null}
                    onSelect={setSelectedId}
                    search={search}
                    onSearchChange={setSearch}
                />
                <BeanDetail
                    bean={selected}
                    isLoading={isLoading}
                    onEdit={(bean) => openModal('edit', bean.id, bean)}
                    onRestock={(id) => openModal('restock', id)}
                    onStartRoast={() => onNavigate?.('roast')}
                />
            </div>
        </div>
    )
}
