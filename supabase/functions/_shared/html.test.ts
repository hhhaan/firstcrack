import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html.ts';

describe('escapeHtml', () => {
    it('renders markup characters as text', () => {
        expect(escapeHtml(`<script>alert("x")</script>`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
        expect(escapeHtml(`a&b`)).toBe('a&amp;b');
        expect(escapeHtml(`'`)).toBe('&#39;');
    });
});
