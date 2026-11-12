export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export const median = (xs: number[]) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted.length % 2
        ? sorted[sorted.length >> 1]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

const MS_COLUMN_WIDTH = 7;

export const formatMs = (ms: number) => ms.toFixed(2).padStart(MS_COLUMN_WIDTH);
