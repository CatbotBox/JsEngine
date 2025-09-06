export type EventListener<T> = (value: T) => void;

export class Event<T> {
  private _listeners: EventListener<T>[] = [];

  public invoke(value: T) {
    [...this._listeners].forEach(l => l(value));
  }
  public add(listener: EventListener<T>) {
    this._listeners.push(listener);
  }
  public remove(listener: EventListener<T>) {
    const i = this._listeners.indexOf(listener);
    if (i >= 0) {
      this._listeners[i] = this._listeners[this._listeners.length - 1];
      this._listeners.pop();
    }
  }
}
