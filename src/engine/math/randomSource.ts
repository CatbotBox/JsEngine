const MULBERRY32_INCREMENT = 0x6D2B79F5;
const MULBERRY32_FIRST_SHIFT = 15;
const MULBERRY32_SECOND_SHIFT = 7;
const MULBERRY32_THIRD_SHIFT = 14;
const MULBERRY32_ODD_MULTIPLIER = 61;
const LOWEST_BIT = 1;
const UINT32_RANGE = 2 ** 32;

export interface RandomSource {
    next(): number;
}

export class Mulberry32Random implements RandomSource {
    private state: number;

    public constructor(seed: number) {
        this.state = seed >>> 0;
    }

    public next(): number {
        this.state = (this.state + MULBERRY32_INCREMENT) | 0;
        let mixed = this.state;
        mixed = Math.imul(mixed ^ (mixed >>> MULBERRY32_FIRST_SHIFT), mixed | LOWEST_BIT);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> MULBERRY32_SECOND_SHIFT), mixed | MULBERRY32_ODD_MULTIPLIER);
        return ((mixed ^ (mixed >>> MULBERRY32_THIRD_SHIFT)) >>> 0) / UINT32_RANGE;
    }
}

export const MATH_RANDOM_SOURCE: RandomSource = {
    next: () => Math.random(),
};

export function randomSourceFor(seed: number | undefined): RandomSource {
    return seed === undefined ? MATH_RANDOM_SOURCE : new Mulberry32Random(seed);
}
