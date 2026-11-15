export class LatestOnly {
    private inFlight = false;
    private pending: (() => Promise<unknown>) | undefined;
    private readonly drained: (() => void)[] = [];

    public get busy(): boolean {
        return this.inFlight;
    }

    public run(task: () => Promise<unknown>): void {
        if (this.inFlight) {
            this.pending = task;
            return;
        }
        this.inFlight = true;
        void task().catch(() => undefined).finally(() => {
            this.inFlight = false;
            const next = this.pending;
            this.pending = undefined;
            if (next !== undefined) {
                this.run(next);
                return;
            }
            for (const callback of this.drained.splice(0)) callback();
        });
    }

    public whenDrained(callback: () => void): void {
        if (this.inFlight) this.drained.push(callback);
        else callback();
    }
}
