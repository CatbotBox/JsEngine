const FIRST_CHANGE_STAMP = 1;

export class ChangeStampCounter {
    private _current = FIRST_CHANGE_STAMP;

    public get current(): number {
        return this._current;
    }

    public advance(): number {
        return ++this._current;
    }
}
