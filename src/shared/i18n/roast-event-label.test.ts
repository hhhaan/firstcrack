import { MARKER_LABEL_CHAR_WIDTH_PX, MARKER_LABEL_FONT_SIZE } from '@features/active-roast/lib/chart-config';
import { estimateLabelWidth, eventLabelText } from '@features/active-roast/lib/chart-option/markers';
import { beforeAll, describe, expect, it } from 'vitest';
import { i18n } from './index';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zhCN from './locales/zh-CN.json';
import { endRoastLabel, markDropLabel, roastEventLabel, roastReadyLabel } from './roast-event-label';

beforeAll(async () => {
    await i18n.init({
        lng: 'en',
        fallbackLng: 'en',
        resources: {
            en: { translation: en },
            ko: { translation: ko },
            ja: { translation: ja },
            'zh-CN': { translation: zhCN },
        },
        interpolation: { escapeValue: false },
    });
});

describe('roast event locale labels', () => {
    it('keeps English identifiers and leaves unknown events, notes, and heater text alone', async () => {
        await i18n.changeLanguage('en');
        expect(roastEventLabel('Charge')).toBe('Charge');
        expect(roastEventLabel('FC Start')).toBe('FC Start');
        expect(roastEventLabel('Drop')).toBe('Drop');
        expect(roastEventLabel('End')).toBe('End');
        expect(roastEventLabel('Mystery')).toBe('Mystery');
        expect(markDropLabel()).toBe('Mark Drop');
        expect(endRoastLabel()).toBe('End Roast');
        expect(roastReadyLabel()).toBe('Roast Ready');
        expect(eventLabelText('Note', 90, '160°C', 'check aroma')).toBe('check aroma|01:30|160°C');
        expect(eventLabelText('Heater', 30, '—', '60%')).toBe('Heater→60%|00:30');
        expect(eventLabelText('Note', 483, '', '가스 메모')).toBe('가스 메모|08:03');
    });

    it('switches the same stored ids to the active locale', async () => {
        await i18n.changeLanguage('ko');
        expect(roastEventLabel('Charge')).toBe('투입');
        expect(roastEventLabel('Yellow')).toBe('옐로잉');
        expect(roastEventLabel('FC Start')).toBe('퍼스트 크랙 시작');
        expect(roastEventLabel('FC Rolling')).toBe('퍼스크크랙롤링');
        expect(roastEventLabel('FC End')).toBe('퍼스트 크랙 종료');
        expect(roastEventLabel('Drop')).toBe('배출');
        expect(roastEventLabel('End')).toBe('로스팅 종료');
        expect(roastEventLabel('TP')).toBe('터닝 포인트');
        expect(markDropLabel()).toBe('배출');
        expect(roastReadyLabel()).toBe('로스팅 준비');
        expect(eventLabelText('FC Start', 480, '196.0°C')).toBe('퍼스트 크랙 시작|08:00|196.0°C');
        expect(roastEventLabel('Mystery')).toBe('Mystery');

        await i18n.changeLanguage('ja');
        expect(roastEventLabel('Charge')).toBe('Charge');
        expect(roastEventLabel('FC Start')).toBe('FC Start');
        expect(endRoastLabel()).toBe('End Roast');

        await i18n.changeLanguage('zh-CN');
        expect(roastEventLabel('Drop')).toBe('Drop');
        expect(roastEventLabel('FC Rolling')).toBe('FC Rolling');
        expect(markDropLabel()).toBe('Mark Drop');

        await i18n.changeLanguage('en');
        expect(eventLabelText('FC Start', 480, '196.0°C')).toBe('FC Start|08:00|196.0°C');
    });

    it('sizes Hangul at one em so the label box matches the canvas glyph', () => {
        expect(estimateLabelWidth('AB')).toBe(MARKER_LABEL_CHAR_WIDTH_PX * 2);
        expect(estimateLabelWidth('투입')).toBe(MARKER_LABEL_FONT_SIZE * 2);
        expect(estimateLabelWidth('투입', 1.5)).toBe(MARKER_LABEL_FONT_SIZE * 2 * 1.5);
    });
});
