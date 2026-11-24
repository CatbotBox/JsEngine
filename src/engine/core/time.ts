export class Time {
    public deltaTimeMs: number = 0;
    public tickDeltaTimeMs: number = 0;
    public frameDeltaTimeMs: number = 0;
    public tickAlpha: number = 0;
    public interpolatingTicks: boolean = false;
    public tickCount: number = 0;
    public frameCount: number = 0;

    public get elapsedTimeMs(): number {
        return performance.now();
    }
}
