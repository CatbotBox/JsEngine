export interface ListSelection<T> {
    readonly selected: readonly T[];
    readonly anchor: T | undefined;
}

export interface SelectionModifiers {
    readonly toggle: boolean;
    readonly extend: boolean;
}

export const PLAIN_CLICK: SelectionModifiers = {toggle: false, extend: false};

export function emptyListSelection<T>(): ListSelection<T> {
    return {selected: [], anchor: undefined};
}

export function selectionModifiersOf(event: {readonly ctrlKey: boolean, readonly metaKey: boolean, readonly shiftKey: boolean}): SelectionModifiers {
    return {toggle: event.ctrlKey || event.metaKey, extend: event.shiftKey};
}

export function clickedSelection<T>(visible: readonly T[], current: ListSelection<T>, clicked: T, modifiers: SelectionModifiers): ListSelection<T> {
    const anchor = current.anchor;
    if (modifiers.extend && anchor !== undefined) {
        const from = visible.indexOf(anchor);
        const to = visible.indexOf(clicked);
        if (from >= 0 && to >= 0) {
            const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1);
            const base = modifiers.toggle ? current.selected.filter(selected => !range.includes(selected)) : [];
            return {selected: [...base, ...(from <= to ? range : range.reverse())], anchor};
        }
    }
    if (!modifiers.toggle) return {selected: [clicked], anchor: clicked};
    const selected = current.selected.includes(clicked) ? current.selected.filter(item => item !== clicked) : [...current.selected, clicked];
    return {selected, anchor: clicked};
}

export function retainedSelection<T>(current: ListSelection<T>, present: (item: T) => boolean): ListSelection<T> {
    const selected = current.selected.filter(present);
    const anchor = current.anchor !== undefined && present(current.anchor) ? current.anchor : undefined;
    return selected.length === current.selected.length && anchor === current.anchor ? current : {selected, anchor};
}
