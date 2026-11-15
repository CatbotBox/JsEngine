export const SERVER_SENT_EVENT_HEARTBEAT_MS = 5000;

const EVENT_STREAM_HEADERS: Readonly<Record<string, string>> = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store",
};
const HEARTBEAT_COMMENT = ": keepalive\n\n";
const CONNECTED_COMMENT = ": connected\n\n";

interface Subscriber {
    write(text: string): boolean;
    close(): void;
}

export interface ServerSentEventChannelOptions {
    readonly onFirstSubscriber?: () => void;
    readonly onLastUnsubscribed?: () => void;
}

export function serverSentEventText(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class ServerSentEventChannel {
    private readonly subscribers = new Set<Subscriber>();
    private heartbeat: ReturnType<typeof setInterval> | undefined;

    public constructor(private readonly options: ServerSentEventChannelOptions = {}) {
    }

    public get subscriberCount(): number {
        return this.subscribers.size;
    }

    public respond(request: Request, headers: Readonly<Record<string, string>>): Response {
        const encoder = new TextEncoder();
        let subscriber: Subscriber | undefined;
        const stream = new ReadableStream<Uint8Array>({
            start: controller => {
                const own: Subscriber = {
                    write: text => {
                        try {
                            controller.enqueue(encoder.encode(text));
                            return true;
                        } catch {
                            this.remove(own);
                            return false;
                        }
                    },
                    close: () => {
                        try {
                            controller.close();
                        } catch {
                            return;
                        }
                    },
                };
                subscriber = own;
                this.add(own);
                own.write(CONNECTED_COMMENT);
            },
            cancel: () => {
                if (subscriber !== undefined) this.remove(subscriber);
            },
        });
        request.signal?.addEventListener("abort", () => {
            if (subscriber !== undefined) this.remove(subscriber);
        });
        return new Response(stream, {headers: {...headers, ...EVENT_STREAM_HEADERS}});
    }

    public send(event: string, data: unknown): void {
        const text = serverSentEventText(event, data);
        for (const subscriber of [...this.subscribers]) subscriber.write(text);
    }

    public close(): void {
        for (const subscriber of [...this.subscribers]) {
            this.remove(subscriber);
            subscriber.close();
        }
    }

    private add(subscriber: Subscriber): void {
        this.subscribers.add(subscriber);
        if (this.subscribers.size !== 1) return;
        this.heartbeat = setInterval(() => {
            for (const each of [...this.subscribers]) each.write(HEARTBEAT_COMMENT);
        }, SERVER_SENT_EVENT_HEARTBEAT_MS);
        this.options.onFirstSubscriber?.();
    }

    private remove(subscriber: Subscriber): void {
        if (!this.subscribers.delete(subscriber)) return;
        if (this.subscribers.size > 0) return;
        if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
        this.heartbeat = undefined;
        this.options.onLastUnsubscribed?.();
    }
}
