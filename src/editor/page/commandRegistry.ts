export type TextEntryPolicy = "blocked" | "allowed" | "allowedWithoutEdits";

export interface KeyChord {
    readonly key: string;
    readonly command: boolean;
    readonly shift: boolean;
    readonly alt: boolean;
}

export interface KeyEventLike {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
}

export interface KeyContext {
    readonly inTextEntry: boolean;
    readonly textEdited: boolean;
}

export interface CommandSpec<A> {
    readonly id: string;
    readonly category: string;
    readonly label: string;
    readonly labelFor?: (argument: A) => string;
    readonly shortcuts?: readonly string[];
    readonly inTextEntry?: TextEntryPolicy;
    readonly yieldsKey?: () => boolean;
    readonly explainsWhenDisabled?: () => boolean;
    readonly target?: () => A;
    readonly choices?: () => readonly A[];
    readonly checked?: (argument: A) => boolean;
    readonly disabledReason?: (argument: A) => string | undefined;
    readonly run: (argument: A) => void;
}

export type VoidCommandSpec = Omit<CommandSpec<void>, "target" | "choices">;

export interface PlannedCommandSpec {
    readonly id: string;
    readonly category: string;
    readonly label: string;
    readonly shortcuts?: readonly string[];
    readonly reason: string;
}

export interface CommandState {
    readonly label: string;
    readonly enabled: boolean;
    readonly reason: string | undefined;
    readonly checked: boolean | undefined;
    readonly shortcutText: string | undefined;
    readonly planned: boolean;
}

export interface CommandChoice {
    readonly state: CommandState;
    run(): boolean;
}

export interface RegisteredCommand {
    readonly id: string;
    readonly category: string;
    readonly label: string;
    readonly shortcuts: readonly KeyChord[];
    readonly planned: boolean;
    readonly invocableAlone: boolean;
    readonly textEntryPolicy: TextEntryPolicy;

    explainsWhenDisabled(): boolean;

    yieldsKey(): boolean;

    stateAlone(): CommandState;

    runAlone(): boolean;

    paletteChoices(): readonly CommandChoice[];
}

export type KeyResolution =
    | {readonly kind: "unbound"}
    | {readonly kind: "passed"}
    | {readonly kind: "bound", readonly command: RegisteredCommand, readonly leavesTextEntry: boolean};

export const COMMAND_MODIFIER_NAME = "Ctrl";
export const SHIFT_MODIFIER_NAME = "Shift";
export const ALT_MODIFIER_NAME = "Alt";
export const NO_TARGET_REASON = "Needs something to act on; use it from a context menu";

const SHORTCUT_SEPARATOR = "+";
const DEFAULT_TEXT_ENTRY_POLICY: TextEntryPolicy = "blocked";
const SINGLE_CHARACTER_LENGTH = 1;
const KEY_ALIASES: Readonly<Record<string, string>> = {del: "delete", esc: "escape", return: "enter", space: " "};
const KEY_DISPLAY_NAMES: Readonly<Record<string, string>> = {delete: "Del", escape: "Esc", " ": "Space", arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right"};
const MODIFIER_FIELDS: Readonly<Record<string, keyof Omit<KeyChord, "key">>> = {
    [COMMAND_MODIFIER_NAME.toLowerCase()]: "command",
    [SHIFT_MODIFIER_NAME.toLowerCase()]: "shift",
    [ALT_MODIFIER_NAME.toLowerCase()]: "alt",
};
const UNBOUND: KeyResolution = {kind: "unbound"};
const PASSED: KeyResolution = {kind: "passed"};
const NEVER_YIELDS = (): boolean => false;
const NO_ARGUMENT = (): void => undefined;

export class ShortcutSyntaxError extends Error {
}

export class CommandRegistrationError extends Error {
}

function normalizedKey(key: string): string {
    const lower = key.toLowerCase();
    return KEY_ALIASES[lower] ?? lower;
}

export function parseShortcut(text: string): KeyChord {
    const parts = text.split(SHORTCUT_SEPARATOR).map(part => part.trim());
    const keyName = parts.pop();
    if (keyName === undefined || keyName.length === 0) throw new ShortcutSyntaxError(`The shortcut "${text}" names no key`);
    const chord = {key: normalizedKey(keyName), command: false, shift: false, alt: false};
    for (const part of parts) {
        const field = MODIFIER_FIELDS[part.toLowerCase()];
        if (field === undefined) throw new ShortcutSyntaxError(`The shortcut "${text}" has an unknown modifier "${part}" (use ${COMMAND_MODIFIER_NAME}, ${SHIFT_MODIFIER_NAME} or ${ALT_MODIFIER_NAME})`);
        if (chord[field]) throw new ShortcutSyntaxError(`The shortcut "${text}" repeats the modifier "${part}"`);
        chord[field] = true;
    }
    return chord;
}

export function keyChordOf(event: KeyEventLike): KeyChord {
    return {key: normalizedKey(event.key), command: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey};
}

export function chordKey(chord: KeyChord): string {
    return [chord.command ? COMMAND_MODIFIER_NAME : "", chord.shift ? SHIFT_MODIFIER_NAME : "", chord.alt ? ALT_MODIFIER_NAME : "", chord.key]
        .filter(part => part.length > 0)
        .join(SHORTCUT_SEPARATOR)
        .toLowerCase();
}

function keyDisplayName(key: string): string {
    const named = KEY_DISPLAY_NAMES[key];
    if (named !== undefined) return named;
    if (key.length === SINGLE_CHARACTER_LENGTH) return key.toUpperCase();
    return key.charAt(0).toUpperCase() + key.slice(1);
}

export function shortcutText(chord: KeyChord): string {
    const parts: string[] = [];
    if (chord.command) parts.push(COMMAND_MODIFIER_NAME);
    if (chord.shift) parts.push(SHIFT_MODIFIER_NAME);
    if (chord.alt) parts.push(ALT_MODIFIER_NAME);
    parts.push(keyDisplayName(chord.key));
    return parts.join(SHORTCUT_SEPARATOR);
}

export class Command<A> implements RegisteredCommand {
    public readonly textEntryPolicy: TextEntryPolicy;

    public constructor(
        private readonly spec: CommandSpec<A>,
        public readonly shortcuts: readonly KeyChord[],
        private readonly plannedReason: string | undefined,
    ) {
        this.textEntryPolicy = spec.inTextEntry ?? DEFAULT_TEXT_ENTRY_POLICY;
    }

    public get id(): string {
        return this.spec.id;
    }

    public get category(): string {
        return this.spec.category;
    }

    public get label(): string {
        return this.spec.label;
    }

    public get planned(): boolean {
        return this.plannedReason !== undefined;
    }

    public get invocableAlone(): boolean {
        return this.spec.target !== undefined;
    }

    public explainsWhenDisabled(): boolean {
        return this.planned || (this.spec.explainsWhenDisabled?.() ?? false);
    }

    public yieldsKey(): boolean {
        return (this.spec.yieldsKey ?? NEVER_YIELDS)();
    }

    public choices(): readonly A[] {
        return this.spec.choices?.() ?? [];
    }

    public target(): {readonly argument: A} | undefined {
        const target = this.spec.target;
        return target === undefined ? undefined : {argument: target()};
    }

    public stateOf(argument: A): CommandState {
        const reason = this.plannedReason ?? this.spec.disabledReason?.(argument);
        return {
            label: this.spec.labelFor?.(argument) ?? this.spec.label,
            enabled: reason === undefined,
            reason,
            checked: this.spec.checked?.(argument),
            shortcutText: this.firstShortcutText(),
            planned: this.planned,
        };
    }

    public runWith(argument: A): boolean {
        if (!this.stateOf(argument).enabled) return false;
        this.spec.run(argument);
        return true;
    }

    public stateAlone(): CommandState {
        const target = this.target();
        if (target !== undefined) return this.stateOf(target.argument);
        return {label: this.spec.label, enabled: false, reason: this.plannedReason ?? NO_TARGET_REASON, checked: undefined, shortcutText: this.firstShortcutText(), planned: this.planned};
    }

    public runAlone(): boolean {
        const target = this.target();
        return target !== undefined && this.runWith(target.argument);
    }

    public paletteChoices(): readonly CommandChoice[] {
        if (this.spec.choices !== undefined) {
            return this.choices().map(argument => ({state: this.stateOf(argument), run: () => this.runWith(argument)}));
        }
        if (!this.invocableAlone && !this.planned) return [];
        return [{state: this.stateAlone(), run: () => this.runAlone()}];
    }

    private firstShortcutText(): string | undefined {
        const first = this.shortcuts[0];
        return first === undefined ? undefined : shortcutText(first);
    }
}

export class CommandRegistry {
    private readonly commands = new Map<string, RegisteredCommand>();
    private readonly bindings = new Map<string, RegisteredCommand>();
    private readonly listeners = new Set<() => void>();

    public add(spec: VoidCommandSpec): Command<void> {
        return this.register({...spec, target: NO_ARGUMENT}, undefined);
    }

    public addTargeted<A>(spec: CommandSpec<A>): Command<A> {
        return this.register(spec, undefined);
    }

    public addPlanned(spec: PlannedCommandSpec): Command<void> {
        return this.register({id: spec.id, category: spec.category, label: spec.label, shortcuts: spec.shortcuts, target: NO_ARGUMENT, run: NO_ARGUMENT}, spec.reason);
    }

    public get(id: string): RegisteredCommand | undefined {
        return this.commands.get(id);
    }

    public all(): readonly RegisteredCommand[] {
        return [...this.commands.values()];
    }

    public commandFor(chord: KeyChord): RegisteredCommand | undefined {
        return this.bindings.get(chordKey(chord));
    }

    public resolveKey(chord: KeyChord, context: KeyContext): KeyResolution {
        const command = this.commandFor(chord);
        if (command === undefined) return UNBOUND;
        const policy = command.textEntryPolicy;
        if (context.inTextEntry && policy === "blocked") return PASSED;
        if (context.inTextEntry && policy === "allowedWithoutEdits" && context.textEdited) return PASSED;
        if (command.yieldsKey()) return PASSED;
        return {kind: "bound", command, leavesTextEntry: context.inTextEntry && policy === "allowedWithoutEdits"};
    }

    public onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public changed(): void {
        for (const listener of [...this.listeners]) listener();
    }

    private register<A>(spec: CommandSpec<A>, plannedReason: string | undefined): Command<A> {
        if (this.commands.has(spec.id)) throw new CommandRegistrationError(`The command ${spec.id} is registered twice`);
        const shortcuts = (spec.shortcuts ?? []).map(parseShortcut);
        if (shortcuts.length > 0 && spec.target === undefined) {
            throw new CommandRegistrationError(`The command ${spec.id} has a shortcut but no target, so a key press could not run it`);
        }
        const keys = shortcuts.map(chordKey);
        for (const [index, key] of keys.entries()) {
            const bound = this.bindings.get(key);
            if (bound !== undefined) throw new CommandRegistrationError(`${shortcutText(shortcuts[index])} is bound to both ${bound.id} and ${spec.id}`);
            if (keys.indexOf(key) !== index) throw new CommandRegistrationError(`The command ${spec.id} lists ${shortcutText(shortcuts[index])} twice`);
        }
        const command = new Command(spec, shortcuts, plannedReason);
        this.commands.set(spec.id, command);
        for (const key of keys) this.bindings.set(key, command);
        return command;
    }
}
