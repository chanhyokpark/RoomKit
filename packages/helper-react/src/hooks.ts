import { useEffect, useRef } from 'react';
import type { MessageHandler, RoomKitHelperEvents } from '@roomkit/helper';
import { useRoomKitContext } from './context.js';

/**
 * Subscribe to a helper event ('message', 'hint', 'hintError', 'subtitle',
 * 'hintCode', 'videoPlay', 'videoStop', 'bridge', 'mode') for this
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
