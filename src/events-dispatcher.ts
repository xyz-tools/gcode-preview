export type CallbackFunction = (..._args: unknown[]) => void;

export class EventsDispatcher {
  private _listeners: { [key: string]: CallbackFunction[] } = {};

  /**
   * Registers a callback for one or more property change events.
   * @param events - Event name or array of event names
   * @param callback - Function to call when the event is emitted
   */
  addEventListener(events: string | string[], callback: CallbackFunction) {
    const eventList = Array.isArray(events) ? events : [events];
    for (const event of eventList) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event]!.push(callback);
    }
  }

  emit(event: string, args: unknown): void {
    (this._listeners[event] || []).forEach((callback) => callback(...(Array.isArray(args) ? args : [args])));
  }
}
