import { z } from 'zod';

export const beanFormSchema = z.object({
    name: z.string().min(1, 'Lot 이름을 입력하세요').max(200),
    origin: z.string().max(100),
    region: z.string().max(100),
    farm: z.string().max(100),
    process: z.string().max(100),
    variety: z.string().max(100),
    altitude: z.string().max(10),
    stock: z.string().max(20),
    capacity: z.string().max(20),
    costPerKg: z.string().max(20),
    tastingNotes: z.string().max(1000),
});

export type BeanForm = z.infer<typeof beanFormSchema>;

export const EMPTY_BEAN_FORM: BeanForm = {
    name: '',
    origin: '',
    region: '',
    farm: '',
    process: 'Washed',
    variety: '',
    altitude: '',
    stock: '',
    capacity: '5',
    costPerKg: '',
    tastingNotes: '',
};
