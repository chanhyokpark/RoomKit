import type { JsonValue } from './json.js';

/**
 * Host side of the component iframe bridge, shared by the player stage and
 * the studio preview so both render component assets identically.
 *
 * Protocol (postMessage, both directions namespaced with `roomkit:`):
 * - iframe → host `{type:'roomkit:ready'}` once the SDK has booted.
 * - host → iframe `{type:'roomkit:init', props, serverUrl, slot, themeId}`
 *   in response.
 * - host → iframe `{type:'roomkit:event', event, payload}` afterwards.
 *
 * Inside the iframe the SDK exposes `window.RoomKit`:
 * - `RoomKit.props` / `RoomKit.slot` — attachment props and mount slot.
 * - `RoomKit.on(event, fn)` → unsubscribe fn; `'init'` fires once props are
 *   available (immediately when already initialized).
 * - `RoomKit.mediaUrl(ref)` — public media URL of an image/file asset, by
 *   asset id or asset name (names resolve via /api/media/by-name).
 *
 * Events by slot: `video` {status, currentTimeMs, durationMs} · `subtitle`
 * {html, lineIndex, lineCount} · `hintCode` {code} · every slot also gets
 * `message` {messageId, messageName, payload} from sendMessage commands.
 *
 * Declarative templates (no creator JS needed): the SDK scans the body once
 * the document is parsed and keeps these bindings up to date on every
 * init/event:
 * - `{{ path }}` in text nodes and attribute values — resolved against
 *   `{props, slot, video, subtitle, hintCode, message}` (the latest payload
 *   per event) and rendered as text. Missing values render as ''.
 * - `{{ media:<asset name or id> }}` — shorthand for `RoomKit.mediaUrl()`,
 *   e.g. `<img src="{{media:로고}}">`.
 * - `data-rk-html="path"` — sets the element's innerHTML (trusted admin
 *   input), e.g. `<div data-rk-html="subtitle.html"></div>`.
 * The `video` payload is augmented for templates with `currentTime` /
 * `duration` ("m:ss") and `progressPercent` (0–100).
 */

export interface ComponentInitMessage {
  type: 'roomkit:init';
  props: Record<string, JsonValue>;
  serverUrl: string;
  slot: string;
  /** Theme scope for name-based media lookups; '' when unknown. */
  themeId: string;
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
  var themeId = '';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function emit(event, payload) {
    var fns = listeners[event] || [];
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](payload); } catch (err) { console.error('[RoomKit component]', err); }
    }
  }

  // --- declarative templates: {{ path }} / data-rk-html (see component-host.ts) ---
  var TPL_RE = /[{][{]([^{}]+)[}][}]/g;
  var events = {};
  var bindings = null;
  var domReady = document.readyState !== 'loading';
  function trim(s) { return s.replace(/^\\s+|\\s+$/g, ''); }
  function resolvePath(expr) {
    expr = trim(expr);
    if (expr.slice(0, 6) === 'media:') return api.mediaUrl(trim(expr.slice(6)));
    var cur = { props: props, slot: slot };
    for (var k in events) cur[k] = events[k];
    var parts = expr.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return '';
      cur = cur[parts[i]];
    }
    if (cur === null || cur === undefined) return '';
    return typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
  }
  function renderTemplate(tpl) {
    return tpl.replace(TPL_RE, function (m, expr) { return resolvePath(expr); });
  }
  function collect() {
    var out = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      if (node.parentNode && node.parentNode.nodeName === 'SCRIPT') continue;
      if (node.nodeValue.indexOf('{{') >= 0) out.push({ kind: 'text', node: node, tpl: node.nodeValue, last: null });
    }
    var els = document.body.getElementsByTagName('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.nodeName === 'SCRIPT') continue;
      for (var j = 0; j < el.attributes.length; j++) {
        var attr = el.attributes[j];
        if (attr.name === 'data-rk-html') out.push({ kind: 'html', el: el, tpl: attr.value, last: null });
        else if (attr.value.indexOf('{{') >= 0) out.push({ kind: 'attr', el: el, name: attr.name, tpl: attr.value, last: null });
      }
    }
    return out;
  }
  function render() {
    // Bindings are collected once, so never scan a half-parsed body.
    if (!domReady) return;
    if (bindings === null) bindings = collect();
    for (var i = 0; i < bindings.length; i++) {
      var b = bindings[i];
      var next = b.kind === 'html' ? resolvePath(b.tpl) : renderTemplate(b.tpl);
      if (next === b.last) continue;
      b.last = next;
      if (b.kind === 'text') b.node.nodeValue = next;
      else if (b.kind === 'attr') b.el.setAttribute(b.name, next);
      else b.el.innerHTML = next;
    }
  }
  function fmtTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }
  /** Template-only derived fields; listeners receive the raw payload. */
  function decorate(event, payload) {
    if (event !== 'video' || !payload || typeof payload !== 'object') return payload;
    var out = {};
    for (var k in payload) out[k] = payload[k];
    if (typeof out.currentTimeMs === 'number') out.currentTime = fmtTime(out.currentTimeMs);
    if (typeof out.durationMs === 'number') out.duration = fmtTime(out.durationMs);
    if (typeof out.currentTimeMs === 'number' && typeof out.durationMs === 'number' && out.durationMs > 0) {
      out.progressPercent = Math.round(Math.min(100, Math.max(0, (out.currentTimeMs / out.durationMs) * 100)) * 100) / 100;
    }
    return out;
  }
  document.addEventListener('DOMContentLoaded', function () { domReady = true; render(); });

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'roomkit:init') {
      props = d.props || {};
      serverUrl = d.serverUrl || '';
      slot = d.slot || '';
      themeId = d.themeId || '';
      initialized = true;
      render();
      emit('init', props);
    } else if (d.type === 'roomkit:event') {
      events[d.event] = decorate(d.event, d.payload);
      render();
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
    mediaUrl: function (ref) {
      ref = String(ref);
      if (UUID_RE.test(ref)) return serverUrl + '/api/media/' + ref;
      return serverUrl + '/api/media/by-name/' + themeId + '/' + encodeURIComponent(ref);
    }
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
