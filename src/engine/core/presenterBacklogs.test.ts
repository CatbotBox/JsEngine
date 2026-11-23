import {describe, expect, test} from "../testing/harness";
import type {PresentationBacklog} from "../platform/platform";
import {PresenterBacklogs} from "./presenterBacklogs";

class ScriptedPresenter implements PresentationBacklog {
    public isBacklogged = false;
    private readonly listeners = new Set<() => void>();

    public get listenerCount(): number {
        return this.listeners.size;
    }

    public backlogged(): boolean {
        return this.isBacklogged;
    }

    public onPresented(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    public present(): void {
        for (const listener of [...this.listeners]) listener();
    }
}

describe("PresenterBacklogs", () => {
    test("is backlogged while any added presenter is, and never without presenters", () => {
        const backlogs = new PresenterBacklogs();
        expect(backlogs.backlogged()).toBe(false);
        const first = new ScriptedPresenter(), second = new ScriptedPresenter();
        backlogs.add(first);
        backlogs.add(second);
        expect(backlogs.backlogged()).toBe(false);
        second.isBacklogged = true;
        expect(backlogs.backlogged()).toBe(true);
        backlogs.remove(second);
        expect([backlogs.backlogged(), backlogs.count]).toEqual([false, 1]);
    });

    test("passes every presented frame of its presenters to its listeners until either side leaves", () => {
        const backlogs = new PresenterBacklogs();
        const presenter = new ScriptedPresenter();
        backlogs.add(presenter);
        let heard = 0;
        const stopListening = backlogs.onPresented(() => heard++);
        presenter.present();
        presenter.present();
        expect(heard).toBe(2);
        stopListening();
        presenter.present();
        expect(heard).toBe(2);
        backlogs.onPresented(() => heard++);
        backlogs.remove(presenter);
        expect(presenter.listenerCount).toBe(0);
        presenter.present();
        expect(heard).toBe(2);
    });

    test("listeners added while waiting hear presenters added later", () => {
        const backlogs = new PresenterBacklogs();
        let heard = 0;
        backlogs.onPresented(() => heard++);
        const presenter = new ScriptedPresenter();
        backlogs.add(presenter);
        presenter.present();
        expect(heard).toBe(1);
    });

    test("removing a presenter that was never added throws", () => {
        expect(() => new PresenterBacklogs().remove(new ScriptedPresenter())).toThrow("never added");
    });
});
