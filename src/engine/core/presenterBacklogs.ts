import type {PresentationBacklog} from "../platform/platform";

const NOT_FOUND = -1;

export class PresenterBacklogs implements PresentationBacklog {
    private readonly _presenters: PresentationBacklog[] = [];
    private readonly _stopListening: (() => void)[] = [];
    private readonly _listeners = new Set<() => void>();

    public get count(): number {
        return this._presenters.length;
    }

    public add(presenter: PresentationBacklog): void {
        this._presenters.push(presenter);
        this._stopListening.push(presenter.onPresented(this.notifyPresented));
    }

    public remove(presenter: PresentationBacklog): void {
        const index = this._presenters.indexOf(presenter);
        if (index === NOT_FOUND) throw new Error("PresenterBacklogs.remove: that presenter was never added");
        this._presenters.splice(index, 1);
        const [stopListening] = this._stopListening.splice(index, 1);
        stopListening();
    }

    public backlogged(): boolean {
        const presenters = this._presenters;
        for (let i = 0; i < presenters.length; i++) {
            if (presenters[i].backlogged()) return true;
        }
        return false;
    }

    public onPresented(listener: () => void): () => void {
        const entry = (): void => listener();
        this._listeners.add(entry);
        return () => {
            this._listeners.delete(entry);
        };
    }

    private readonly notifyPresented = (): void => {
        for (const listener of this._listeners) listener();
    };
}
