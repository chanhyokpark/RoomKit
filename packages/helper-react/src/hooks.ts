import { useEffect, useRef } from 'react';
import type { MessageHandler, RoomKitHelperEvents, StateHandler } from '@roomkit/helper';
import { useRoomKitContext } from './context.js';

/**
 * Subscribe to a helper event ('message', 'hint', 'hintError', 'subtitle',
 * 'hintCode', 'videoPlay', 'videoStop', 'bridge', 'mode', 'state') for this
 * component's lifetime. The handler is kept in a ref, so an inline closure is
 * fine. For awaited messages, a promise returned by a 'message' handler is
 * awaited before the command is acked.
 */
export function useRoomKitEvent<K extends keyof RoomKitHelperEvents>(
  event: K,
  handler: (...args: RoomKitHelperEvents[K]) => unknown,
): void {
  const ctx = useRoomKitContext();
  const relay = ctx?.relay ?? null;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!relay) return;
    const listener = (...args: RoomKitHelperEvents[K]) => handlerRef.current(...args);
    relay.on(event, listener);
    return () => {
      relay.off(event, listener);
    };
  }, [relay, event]);
}

/**
 * Subscribe to player-relayed messages for this component's lifetime — the
 * intuitive way to handle messages per page instead of pre-registering
 * everything at the provider. Pass a name to receive only that message asset
 * (declare it in the provider's `messages` option so the debug window lists
 * it), or just a handler for every message. A returned promise is awaited
 * before an awaited (waitUntilEnd) message command is acked.
 */
export function useRoomKitMessage(handler: MessageHandler): void;
export function useRoomKitMessage(name: string, handler: MessageHandler): void;
export function useRoomKitMessage(a: string | MessageHandler, b?: MessageHandler): void {
  const name = typeof a === 'string' ? a : undefined;
  const handler = typeof a === 'string' ? b : a;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useRoomKitEvent('message', (payload, envelope) => {
    if (name !== undefined && envelope.messageName !== name) return;
    return handlerRef.current?.(payload, envelope);
  });
}

/**
 * React to the device's durable state for this component's lifetime. Pass a
 * state asset name to run the handler when that state becomes active
 * (immediately if it already is) — `'default'` runs when no state is active —
 * or just a handler for every change. Reconnect replays of an unchanged state
 * do not re-fire. For rendering, `useRoomKit().state` is usually enough; this
 * hook is for side effects (start an animation, play a sound).
 */
export function useRoomKitState(handler: StateHandler): void;
export function useRoomKitState(name: string, handler: StateHandler): void;
export function useRoomKitState(a: string | StateHandler, b?: StateHandler): void {
  const name = typeof a === 'string' ? a : undefined;
  const handler = typeof a === 'string' ? b : a;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const ctx = useRoomKitContext();
  const helper = ctx?.core?.helper ?? null;

  useRoomKitEvent('state', (state) => {
    if (name !== undefined && state.name !== name) return;
    handlerRef.current?.(state.payload, state);
  });
  // The relay only sees changes; fire once for a state already active at mount.
  useEffect(() => {
    if (!helper || name === undefined) return;
    const current = helper.state;
    if (current.name === name) handlerRef.current?.(current.payload, current);
  }, [helper, name]);
}
