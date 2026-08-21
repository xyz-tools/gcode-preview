import { test, expect, describe, vi } from 'vitest';
import { EventsDispatcher } from '../events-dispatcher';

describe('EventsDispatcher', () => {
  describe('addEventListener', () => {
    test('registers a callback for a single event', () => {
      const dispatcher = new EventsDispatcher();
      const callback = vi.fn();

      dispatcher.addEventListener('testEvent', callback);
      dispatcher.emit('testEvent', 'arg1');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('arg1');
    });

    test('registers a callback for multiple events', () => {
      const dispatcher = new EventsDispatcher();
      const callback = vi.fn();

      dispatcher.addEventListener(['event1', 'event2'], callback);
      dispatcher.emit('event1', 'arg1');
      dispatcher.emit('event2', 'arg2');

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenNthCalledWith(1, 'arg1');
      expect(callback).toHaveBeenNthCalledWith(2, 'arg2');
    });

    test('allows multiple callbacks for the same event', () => {
      const dispatcher = new EventsDispatcher();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      dispatcher.addEventListener('testEvent', callback1);
      dispatcher.addEventListener('testEvent', callback2);
      dispatcher.emit('testEvent', 'arg');

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe('emit', () => {
    test('calls all registered callbacks for an event', () => {
      const dispatcher = new EventsDispatcher();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      dispatcher.addEventListener('testEvent', callback1);
      dispatcher.addEventListener('testEvent', callback2);
      dispatcher.emit('testEvent', 'data');

      expect(callback1).toHaveBeenCalledWith('data');
      expect(callback2).toHaveBeenCalledWith('data');
    });

    test('does nothing when emitting an unregistered event', () => {
      const dispatcher = new EventsDispatcher();
      const callback = vi.fn();

      dispatcher.addEventListener('registeredEvent', callback);
      dispatcher.emit('unregisteredEvent', 'data');

      expect(callback).not.toHaveBeenCalled();
    });

    test('passes array arguments as spread parameters', () => {
      const dispatcher = new EventsDispatcher();
      const callback = vi.fn();

      dispatcher.addEventListener('testEvent', callback);
      dispatcher.emit('testEvent', ['arg1', 'arg2', 'arg3']);

      expect(callback).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
    });

    test('wraps non-array arguments in array', () => {
      const dispatcher = new EventsDispatcher();
      const callback = vi.fn();

      dispatcher.addEventListener('testEvent', callback);
      dispatcher.emit('testEvent', { key: 'value' });

      expect(callback).toHaveBeenCalledWith({ key: 'value' });
    });

    test('handles undefined arguments', () => {
      const dispatcher = new EventsDispatcher();
      const callback = vi.fn();

      dispatcher.addEventListener('testEvent', callback);
      dispatcher.emit('testEvent', undefined);

      expect(callback).toHaveBeenCalledWith(undefined);
    });

    test('handles null arguments', () => {
      const dispatcher = new EventsDispatcher();
      const callback = vi.fn();

      dispatcher.addEventListener('testEvent', callback);
      dispatcher.emit('testEvent', null);

      expect(callback).toHaveBeenCalledWith(null);
    });
  });

  describe('integration', () => {
    test('callbacks are independent per event type', () => {
      const dispatcher = new EventsDispatcher();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      dispatcher.addEventListener('event1', callback1);
      dispatcher.addEventListener('event2', callback2);

      dispatcher.emit('event1', 'data1');

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();
    });

    test('same callback can be registered for different events', () => {
      const dispatcher = new EventsDispatcher();
      const callback = vi.fn();

      dispatcher.addEventListener('event1', callback);
      dispatcher.addEventListener('event2', callback);

      dispatcher.emit('event1', 'data1');
      dispatcher.emit('event2', 'data2');

      expect(callback).toHaveBeenCalledTimes(2);
    });
  });
});
