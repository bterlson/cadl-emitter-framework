export class Placeholder<T> {
  #listeners: ((value: T) => void)[] = [];
  setValue(value: T) {
    for (const listener of this.#listeners) {
      listener(value);
    }
  }

  onValue(cb: (value: T) => void) {
    this.#listeners.push(cb);
  }
}
