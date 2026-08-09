/** Escape a CSV field — wrap in quotes if it contains comma, quote, or newline. */
export const escapeCsvField = (val: string): string => {
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
        return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
};
