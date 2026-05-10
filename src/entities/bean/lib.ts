import type { Bean } from '../../shared/types/database.types'

export type BeanStatus = 'Good' | 'Low' | 'Out'

export const getStatus = (bean: Bean): BeanStatus => {
    if (bean.stock_grams === 0) return 'Out'
    if (bean.stock_grams <= bean.low_stock_threshold_grams) return 'Low'
    return 'Good'
}

export const statusConfig: Record<BeanStatus, { color: string; bg: string; label: string }> = {
    Good: { color: '#16a34a', bg: 'rgba(220,252,231,0.8)', label: 'In Stock' },
    Low: { color: '#d97706', bg: 'rgba(254,243,199,0.8)', label: 'Low Stock' },
    Out: { color: '#dc2626', bg: 'rgba(254,226,226,0.8)', label: 'Out of Stock' },
}

export const processColor: Record<string, { color: string; bg: string }> = {
    Natural: { color: '#92400e', bg: 'rgba(253,230,214,0.8)' },
    Washed: { color: '#1e40af', bg: 'rgba(219,234,254,0.8)' },
    Honey: { color: '#a16207', bg: 'rgba(254,243,199,0.8)' },
    Anaerobic: { color: '#7e22ce', bg: 'rgba(243,232,255,0.8)' },
    Experimental: { color: '#be185d', bg: 'rgba(252,231,243,0.8)' },
}
