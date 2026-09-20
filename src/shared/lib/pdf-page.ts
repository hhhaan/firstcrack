/** A4 landscape in PDF points (1/72 in). 297mm × 210mm. */
export const A4_LANDSCAPE_PT = { width: 841.89, height: 595.28 } as const;

const encoder = new TextEncoder();

const concat = (parts: Uint8Array[]): Uint8Array => {
    let length = 0;
    for (const part of parts) length += part.length;
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
};

const obj = (n: number, body: string): Uint8Array => encoder.encode(`${n} 0 obj\n${body}\nendobj\n`);

const streamObj = (n: number, dict: string, data: Uint8Array): Uint8Array =>
    concat([encoder.encode(`${n} 0 obj\n${dict}\nstream\n`), data, encoder.encode('\nendstream\nendobj\n')]);

/**
 * Wrap a JPEG as a single-page landscape A4 PDF. The image fills the page
 * (caller must compose at the A4 aspect so it is not stretched).
 *
 * Helvetica cannot paint CJK, so the page is an image XObject only.
 */
export const jpegToLandscapeA4Pdf = (jpeg: Uint8Array, imgWidth: number, imgHeight: number): Uint8Array => {
    if (jpeg.byteLength < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
        throw new Error('jpegToLandscapeA4Pdf: expected a JPEG');
    }
    if (imgWidth < 1 || imgHeight < 1) {
        throw new Error('jpegToLandscapeA4Pdf: image size must be positive');
    }

    const { width: pageW, height: pageH } = A4_LANDSCAPE_PT;
    const contents = encoder.encode(`q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im1 Do\nQ\n`);

    const objects = [
        obj(1, '<< /Type /Catalog /Pages 2 0 R >>'),
        obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
        obj(
            3,
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>`,
        ),
        streamObj(4, `<< /Length ${contents.byteLength} >>`, contents),
        streamObj(
            5,
            `<< /Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>`,
            jpeg,
        ),
    ];

    const header = encoder.encode('%PDF-1.4\n%\x80\x80\x80\x80\n');
    const parts: Uint8Array[] = [header];
    const objOffsets: number[] = [];
    let offset = header.byteLength;
    for (const object of objects) {
        objOffsets.push(offset);
        parts.push(object);
        offset += object.byteLength;
    }

    const xrefLines = ['xref', `0 ${objOffsets.length + 1}`, '0000000000 65535 f '];
    for (const objOffset of objOffsets) {
        xrefLines.push(`${String(objOffset).padStart(10, '0')} 00000 n `);
    }
    xrefLines.push(`trailer\n<< /Size ${objOffsets.length + 1} /Root 1 0 R >>`, 'startxref', String(offset), '%%EOF\n');
    parts.push(encoder.encode(xrefLines.join('\n')));
    return concat(parts);
};

export const dataUrlToBytes = (dataUrl: string): Uint8Array => {
    const comma = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:') || comma < 0) {
        throw new Error('dataUrlToBytes: expected a data URL');
    }
    const binary = atob(dataUrl.slice(comma + 1));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
};
