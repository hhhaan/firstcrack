/** Trigger a browser download of a Blob. Works in both Tauri and web. */
export const downloadBlob = (filename: string, blob: Blob): void => {
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
};

/** Trigger a browser download of a CSV string. */
export const downloadCsv = (filename: string, csv: string): void => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(filename, blob);
};
