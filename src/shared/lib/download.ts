/** Trigger a browser download for a Blob. */
export const downloadBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

/** Download a UTF-8 CSV string (caller may include BOM). */
export const downloadCsv = (csv: string, filename: string): void => {
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
};
