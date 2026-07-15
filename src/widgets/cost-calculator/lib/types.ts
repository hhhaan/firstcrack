export type SourceMode = 'single' | 'blend';
export type BlendSourceMode = 'saved' | 'custom';

export type BlendComponentCost = {
    id: string;
    beanId: string;
    name: string;
    ratioPct: number;
    costPerKg: number | null;
};

export type FixedOverheadItem = {
    id: string;
    name: string;
    amountPerKg: number;
};
