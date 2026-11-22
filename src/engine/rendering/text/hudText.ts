const PLACEHOLDER = /\{(\w+)\}/g;

export type HudValues = Readonly<Record<string, string | number>>;

export function formatHudText(template: string, values: HudValues): string {
    return template.replace(PLACEHOLDER, (placeholder: string, name: string) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder);
}

export function formatHudLines(lines: readonly string[], values: HudValues): string[] {
    return lines.map(line => formatHudText(line, values));
}
