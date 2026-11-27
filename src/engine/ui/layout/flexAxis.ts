export type Axis = 0 | 1;
export type AxisArrays = [Float64Array, Float64Array];

export const AXIS_X: Axis = 0;
export const AXIS_Y: Axis = 1;
export const AXES: readonly Axis[] = [AXIS_X, AXIS_Y];

export function crossOf(axis: Axis): Axis {
    return axis === AXIS_X ? AXIS_Y : AXIS_X;
}

export function axisArrays(capacity: number): AxisArrays {
    return [new Float64Array(capacity), new Float64Array(capacity)];
}
