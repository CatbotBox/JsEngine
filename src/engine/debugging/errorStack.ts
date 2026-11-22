const STACK_LINE_SEPARATOR = "\n";
const LEADING_LINE_BREAK = /^\r?\n/;

export function errorHeadline(error: Error): string {
    return error.message.length === 0 ? error.name : `${error.name}: ${error.message}`;
}

export function stackFramesOrUndefined(frames: string): string | undefined {
    return frames.trim().length === 0 ? undefined : frames;
}

export function errorFrames(error: Error): string | undefined {
    const stack = error.stack;
    if (stack === undefined) return undefined;
    const headline = errorHeadline(error);
    const frames = stack.startsWith(headline) ? stack.slice(headline.length).replace(LEADING_LINE_BREAK, "") : stack;
    return stackFramesOrUndefined(frames);
}

export function errorFramesOf(error: unknown): string | undefined {
    return error instanceof Error ? errorFrames(error) : undefined;
}

export function adoptStackFrames<E extends Error>(error: E, frames: string | undefined): E {
    if (frames !== undefined) error.stack = `${errorHeadline(error)}${STACK_LINE_SEPARATOR}${frames}`;
    return error;
}
