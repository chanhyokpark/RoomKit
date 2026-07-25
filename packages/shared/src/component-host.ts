import type { JsonValue } from './json.js';

/**
 * Host side of the component iframe bridge, shared by the player stage and
 * the studio preview so both render component assets identically.
 *
 * Protocol (postMessage, both directions namespaced with `roomkit:`):
 * - iframe → host `{type:'roomkit:ready'}` once the SDK has booted.
 * - host → iframe `{type:'roomkit:init', props, serverUrl, slot}` in response.
 * - host → iframe `{type:'roomkit:event', event, payload}` afterwards.
 *
 * Inside the iframe the SDK exposes `window.RoomKit`:
 * - `RoomKit.props` / `RoomKit.slot` — attachment props and mount slot.
 * - `RoomKit.on(event, fn)` → unsubscribe fn; `'init'` fires once props are
 *   available (immediately when already initialized).
 * - `RoomKit.mediaUrl(assetId)` — public media URL of an image/file asset.
 *
 * Events by slot: `video` {status, currentTimeMs, durationMs} · `subtitle`
 * {html, lineIndex, lineCount} · `hintCode` {code} · every slot also gets
 * `message` {messageId, messageName, payload} from sendMessage commands.
 */

export interface ComponentInitMessage {
  type: 'roomkit:init';
  props: Record<string, JsonValue>;
  serverUrl: string;
  slot: string;
}

export interface ComponentEventMessage {
  type: 'roomkit:event';
  event: string;
  payload: JsonValue;
}

export type ComponentHostMessage = ComponentInitMessage | ComponentEventMessage;

export const COMPONENT_READY_TYPE = 'roomkit:ready';

/** Minimal structural type of `iframe.contentWindow` (shared has no DOM lib). */
export interface ComponentFrameWindow {
  postMessage(message: ComponentHostMessage, targetOrigin: string): void;
}

/**
 * Buffers events until the iframe SDK reports ready, then replays them in
 * order after the init message. Wire it to the host's `message` listener via
 * `handleReady()` (after the host has matched `event.source` / message type).
 */
export class ComponentBridge {
  private ready = false;
  private queue: ComponentEventMessage[] = [];

  constructor(
    private readonly frame: () => ComponentFrameWindow | null,
    private readonly init: Omit<ComponentInitMessage, 'type'>,
  ) {}

  handleReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.send({ type: 'roomkit:init', ...this.init });
    for (const message of this.queue) this.send(message);
    this.queue = [];
  }

  post(event: string, payload: JsonValue): void {
    const message: ComponentEventMessage = {
      type: 'roomkit:event',
      event,
      payload,
    };
    if (!this.ready) {
      this.queue.push(message);
      return;
    }
    this.send(message);
  }

  private send(message: ComponentHostMessage): void {
    // srcdoc iframes are same-process; '*' is fine (sandboxed origin is null).
    this.frame()?.postMessage(message, '*');
  }
}

/**
 * The in-iframe SDK. Kept free of the literal script-close sequence so it can
 * be embedded in an inline script tag.
 */
const SDK_SOURCE = `
window.RoomKit = (function () {
  var listeners = {};
  var initialized = false;
  var props = {};
  var serverUrl = '';
  var slot = '';
  function emit(event, payload) {
    var fns = listeners[event] || [];
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](payload); } catch (err) { console.error('[RoomKit component]', err); }
    }
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'roomkit:init') {
      props = d.props || {};
      serverUrl = d.serverUrl || '';
      slot = d.slot || '';
      initialized = true;
      emit('init', props);
    } else if (d.type === 'roomkit:event') {
      emit(d.event, d.payload);
    }
  });
  var api = {
    get props() { return props; },
    get slot() { return slot; },
    on: function (event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      if (event === 'init' && initialized) fn(props);
      return function () { api.off(event, fn); };
    },
    off: function (event, fn) {
      var fns = listeners[event] || [];
      var idx = fns.indexOf(fn);
      if (idx >= 0) fns.splice(idx, 1);
    },
    mediaUrl: function (assetId) { return serverUrl + '/api/media/' + assetId; }
  };
  parent.postMessage({ type: '${COMPONENT_READY_TYPE}' }, '*');
  return api;
})();
`;

/**
 * Wraps creator-authored component markup into the full iframe document:
 * transparent full-size body plus the bridge SDK loaded before the creator's
 * own inline scripts. Mount with `sandbox="allow-scripts"` (fault isolation —
 * the content itself is trusted admin input).
 */
export function buildComponentSrcdoc(html: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}</style>' +
    '<script>' +
    SDK_SOURCE +
    '<' +
    '/script></head><body>' +
    html +
    '</body></html>'
  );
}
