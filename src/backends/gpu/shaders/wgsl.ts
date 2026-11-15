const ONE_DECIMAL = 1;

export function wgslFloat(value: number): string {
    return Number.isInteger(value) ? value.toFixed(ONE_DECIMAL) : String(value);
}
