/**
 * Shared measurement helpers for bench/.
 *
 * These lived in three copies (boundsCascade, soaGate, boundsWriteAB) until the two
 * one-shot gates were deleted. `median` came from soaGate and is the one worth keeping:
 * CLAUDE.md's benchmarking note says to take medians rather than means, because a single
 * GC pause skews a mean over a 25-frame sample far more than it moves the middle value.
 */

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export const median = (xs: number[]) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted.length % 2
        ? sorted[sorted.length >> 1]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

/** Fixed-width ms formatting so columns line up in the printed table. */
export const fmt = (x: number) => x.toFixed(2).padStart(7);
