import {CHANNEL_MASK, CHANNEL_MAX, GREEN_SHIFT, RED_SHIFT} from "@jsengine/engine/rendering";
import type {RandomSource} from "@jsengine/engine/math";

const BLUE_SHIFT = 0;
const FULLY_INTERPOLATED = 1;
const NOT_INTERPOLATED = 0;

function packRgb(r: number, g: number, b: number): number {
    return (r << RED_SHIFT) | (g << GREEN_SHIFT) | b;
}

function randomChannel(random: RandomSource): number {
    return Math.round(random.next() * CHANNEL_MAX);
}

export function randomRgb(random: RandomSource): number {
    const r = randomChannel(random);
    const g = randomChannel(random);
    const b = randomChannel(random);
    return packRgb(r, g, b);
}

function channelOf(rgb: number, shift: number): number {
    return (rgb >> shift) & CHANNEL_MASK;
}

function interpolateChannel(from: number, to: number, shift: number, progress: number): number {
    const start = channelOf(from, shift);
    return Math.round(start + (channelOf(to, shift) - start) * progress);
}

export function interpolateRgb(from: number, to: number, progress: number): number {
    if (progress >= FULLY_INTERPOLATED) return to;
    if (progress <= NOT_INTERPOLATED) return from;
    return packRgb(interpolateChannel(from, to, RED_SHIFT, progress), interpolateChannel(from, to, GREEN_SHIFT, progress), interpolateChannel(from, to, BLUE_SHIFT, progress));
}
