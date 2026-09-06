/** UI carrier dropdown — ids must match EF `CARRIERS` keys (carriers.test.ts enforces). */

export const CARRIER_OPTIONS = [
    { id: 'cj', labelKo: 'CJ대한통운', labelEn: 'CJ Logistics' },
    { id: 'hanjin', labelKo: '한진택배', labelEn: 'Hanjin' },
    { id: 'lotte', labelKo: '롯데택배', labelEn: 'Lotte' },
    { id: 'post_office', labelKo: '우체국택배', labelEn: 'Korea Post' },
    { id: 'logen', labelKo: '로젠택배', labelEn: 'Logen' },
    { id: 'dhl', labelKo: 'DHL', labelEn: 'DHL Express' },
    { id: 'fedex', labelKo: 'FedEx', labelEn: 'FedEx' },
    { id: 'ups', labelKo: 'UPS', labelEn: 'UPS' },
    { id: 'other', labelKo: '기타/자체배송', labelEn: 'Other / self-delivery' },
] as const;

export type ClientCarrierId = (typeof CARRIER_OPTIONS)[number]['id'];
