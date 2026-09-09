import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  compareVersions,
  type AdminCallState,
  type CallAcceptInput,
  type CallActionAck,
  type CallDeclineInput,
  type CallEndInput,
  type CallEndReason,
  type CallErrorReason,
  type CallInfo,
  type CallRequestAck,
  type CallStartInput,
  type CallStatusReport,
  type DeviceCallState,
  type IceServer,
} from '@roomkit/shared';
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env';
import { SessionRuntimeService } from '../runtime/session-runtime.service';
import { ConnectionRegistry } from './connection-registry';

/** Oldest @roomkit/client that understands `call:state`. */
const MIN_CLIENT_VERSION = '0.5.0';
/** A device that never reports its media outcome frees the call slot. */
export const CALL_CONNECT_TIMEOUT_MS = 30_000;

interface ActiveCall extends CallInfo {
  connectTimer: NodeJS.Timeout | null;
}

type AdminListener = (state: AdminCallState) => void;
type DeviceListener = (
  sessionId: string,
  deviceId: string,
  state: DeviceCallState,
) => void;

/**
 * Operator ↔ hintphone voice calls: one call per session, held in memory.
 * Ownership is the /admin socket that started or accepted the call — only
 * it can end the call, and its disconnect ends the call. PeerJS media runs
 * peer-to-peer; this service only sequences the signaling ids.
 *
 * The gateways subscribe through `onAdminChange`/`onDeviceState` (rather than
 * this service depending on them) so the DI graph stays acyclic.
 */
@Injectable()
export class CallService implements OnModuleDestroy {
  private readonly calls = new Map<string, ActiveCall>();
  private readonly adminListeners = new Set<AdminListener>();
  private readonly deviceListeners = new Set<DeviceListener>();

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly runtime: SessionRuntimeService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleDestroy(): void {
    for (const call of this.calls.values()) {
      if (call.connectTimer) clearTimeout(call.connectTimer);
    }
    this.calls.clear();
  }

  onAdminChange(listener: AdminListener): void {
    this.adminListeners.add(listener);
  }

  onDeviceState(listener: DeviceListener): void {
    this.deviceListeners.add(listener);
  }

  iceServers(): IceServer[] | null {
    return this.config.get('CALL_ICE_SERVERS', { infer: true }) ?? null;
  }

  /** Every session's call — the /admin connect dump. */
  listCalls(): CallInfo[] {
    return [...this.calls.values()].map((call) => this.info(call));
  }

  callFor(sessionId: string): CallInfo | null {
    const call = this.calls.get(sessionId);
    return call ? this.info(call) : null;
  }

  // ── admin ops ────────────────────────────────────────────────────────────

  start(
    adminSocketId: string,
    input: CallStartInput,
    deviceName: string,
  ): CallActionAck {
    const refused = this.eligibility(input.sessionId, input.deviceId);
    if (refused) return { ok: false, reason: refused };
    if (this.calls.has(input.sessionId)) return { ok: false, reason: 'busy' };
    const call = this.create(input.sessionId, input.deviceId, deviceName);
    call.status = 'connecting';
    call.adminSocketId = adminSocketId;
    call.adminPeerId = input.peerId;
    call.startedAt = Date.now();
    this.armConnectTimer(call);
    this.log(call, 'info', `Call started by operator to "${deviceName}"`);
    this.sendConnecting(call);
    this.broadcast(call.sessionId);
    return { ok: true, call: this.info(call) };
  }

  accept(adminSocketId: string, input: CallAcceptInput): CallActionAck {
    const call = this.calls.get(input.sessionId);
    if (!call || call.callId !== input.callId) {
      return { ok: false, reason: 'no_call' };
    }
    if (call.status !== 'requested') return { ok: false, reason: 'busy' };
    const refused = this.eligibility(call.sessionId, call.deviceId);
    if (refused) return { ok: false, reason: refused };
    call.status = 'connecting';
    call.adminSocketId = adminSocketId;
    call.adminPeerId = input.peerId;
    call.startedAt = Date.now();
    this.armConnectTimer(call);
    this.log(call, 'info', `Call request from "${call.deviceName}" accepted`);
    this.sendConnecting(call);
    this.broadcast(call.sessionId);
    return { ok: true, call: this.info(call) };
  }

  decline(input: CallDeclineInput): CallActionAck {
    const call = this.calls.get(input.sessionId);
    if (!call || call.callId !== input.callId) {
      return { ok: false, reason: 'no_call' };
    }
    if (call.status !== 'requested') return { ok: false, reason: 'busy' };
    const info = this.info(call);
    this.endCall(call, 'declined');
    return { ok: true, call: info };
  }

  end(adminSocketId: string, input: CallEndInput): CallActionAck {
    const call = this.calls.get(input.sessionId);
    if (!call || call.status === 'requested') {
      return { ok: false, reason: 'no_call' };
    }
    if (call.adminSocketId !== adminSocketId) {
      return { ok: false, reason: 'not_owner' };
    }
    const info = this.info(call);
    this.endCall(call, 'admin_ended');
    return { ok: true, call: info };
  }

  // ── device ops ───────────────────────────────────────────────────────────

  request(
    sessionId: string,
    deviceId: string,
    deviceName: string,
  ): CallRequestAck {
    const refused = this.eligibility(sessionId, deviceId);
    if (refused) return { ok: false, reason: refused };
    if (this.calls.has(sessionId)) return { ok: false, reason: 'busy' };
    const call = this.create(sessionId, deviceId, deviceName);
    call.requestedAt = Date.now();
    this.log(call, 'info', `Device "${deviceName}" requested a call`);
    this.broadcast(sessionId);
    return { ok: true, callId: call.callId };
  }

  cancel(sessionId: string, deviceId: string, callId: string): void {
    const call = this.calls.get(sessionId);
    if (!call || call.callId !== callId || call.deviceId !== deviceId) return;
    // Once an operator accepted, the server's state wins — the player keeps
    // showing the call until the server ends it.
    if (call.status !== 'requested') return;
    this.endCall(call, 'cancelled');
  }

  report(sessionId: string, deviceId: string, report: CallStatusReport): void {
    const call = this.calls.get(sessionId);
    if (
      !call ||
      call.callId !== report.callId ||
      call.deviceId !== deviceId ||
      call.status === 'requested'
    ) {
      return;
    }
    if (report.status === 'failed') {
      this.log(call, 'warn', `Call to "${call.deviceName}" failed`, {
        reason: report.reason ?? null,
      });
      this.endCall(call, 'device_failed', { detail: report.reason });
      return;
    }
    if (call.status === 'connected') return;
    call.status = 'connected';
    call.connectedAt = Date.now();
    this.clearConnectTimer(call);
    // A device without microphone access still connects listen-only and
    // says so in `reason`; keep that visible in the session log.
    const listenOnly = report.reason === 'mic_denied';
    this.log(
      call,
      'info',
      `Call with "${call.deviceName}" connected${listenOnly ? ' (listen-only: microphone denied)' : ''}`,
      listenOnly ? { reason: 'mic_denied' } : undefined,
    );
    this.broadcast(sessionId);
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  adminDisconnected(adminSocketId: string): void {
    for (const call of [...this.calls.values()]) {
      if (call.adminSocketId === adminSocketId) {
        this.endCall(call, 'admin_disconnected');
      }
    }
  }

  deviceOffline(sessionId: string, deviceId: string): void {
    const call = this.calls.get(sessionId);
    if (!call || call.deviceId !== deviceId) return;
    this.endCall(call, 'device_offline', { notifyDevice: false });
  }

  /** Runs before the ended session's device sockets are detached. */
  sessionEnded(sessionId: string): void {
    const call = this.calls.get(sessionId);
    if (call) this.endCall(call, 'session_ended');
  }

  // ── internals ────────────────────────────────────────────────────────────

  private eligibility(
    sessionId: string,
    deviceId: string,
  ): CallErrorReason | null {
    const session = this.runtime.getSessionState(sessionId);
    if (!session || session.state === 'ended') return 'session_not_live';
    if (session.mode === 'test') return 'test_session';
    if (!this.registry.isOnline(sessionId, deviceId)) return 'device_offline';
    const versions = this.registry.versionsFor(sessionId, deviceId);
    if (versions.helperVersion === undefined) return 'no_helper';
    if (
      !versions.clientVersion ||
      compareVersions(versions.clientVersion, MIN_CLIENT_VERSION) < 0
    ) {
      return 'device_outdated';
    }
    return null;
  }

  private create(
    sessionId: string,
    deviceId: string,
    deviceName: string,
  ): ActiveCall {
    const call: ActiveCall = {
      callId: randomUUID(),
      sessionId,
      deviceId,
      deviceName,
      status: 'requested',
      adminSocketId: null,
      adminPeerId: null,
      devicePeerId: `rk-${randomUUID()}`,
      requestedAt: null,
      startedAt: null,
      connectedAt: null,
      connectTimer: null,
    };
    this.calls.set(sessionId, call);
    return call;
  }

  private armConnectTimer(call: ActiveCall): void {
    this.clearConnectTimer(call);
    call.connectTimer = setTimeout(() => {
      call.connectTimer = null;
      if (this.calls.get(call.sessionId) !== call) return;
      if (call.status !== 'connecting') return;
      this.log(call, 'warn', `Call to "${call.deviceName}" timed out`);
      this.endCall(call, 'timeout');
    }, CALL_CONNECT_TIMEOUT_MS);
  }

  private clearConnectTimer(call: ActiveCall): void {
    if (call.connectTimer) {
      clearTimeout(call.connectTimer);
      call.connectTimer = null;
    }
  }

  private endCall(
    call: ActiveCall,
    reason: CallEndReason,
    {
      notifyDevice = true,
      detail,
    }: { notifyDevice?: boolean; detail?: string } = {},
  ): void {
    if (this.calls.get(call.sessionId) !== call) return;
    this.clearConnectTimer(call);
    this.calls.delete(call.sessionId);
    this.log(call, 'info', `Call with "${call.deviceName}" ended`, { reason });
    if (notifyDevice) {
      this.emitDevice(call, { status: 'ended', callId: call.callId, reason });
    }
    this.broadcast(call.sessionId, reason, detail);
  }

  private sendConnecting(call: ActiveCall): void {
    this.emitDevice(call, {
      status: 'connecting',
      callId: call.callId,
      adminPeerId: call.adminPeerId as string,
      devicePeerId: call.devicePeerId,
      iceServers: this.iceServers(),
    });
  }

  private emitDevice(call: ActiveCall, state: DeviceCallState): void {
    for (const listener of this.deviceListeners) {
      listener(call.sessionId, call.deviceId, state);
    }
  }

  private broadcast(
    sessionId: string,
    endReason?: CallEndReason,
    endDetail?: string,
  ): void {
    const state: AdminCallState = {
      sessionId,
      call: this.callFor(sessionId),
      ...(endReason ? { endReason } : {}),
      ...(endDetail ? { endDetail } : {}),
    };
    for (const listener of this.adminListeners) listener(state);
  }

  private log(
    call: ActiveCall,
    level: 'info' | 'warn',
    message: string,
    data: Record<string, string | null> = {},
  ): void {
    this.runtime.log(call.sessionId, level, 'call', message, {
      callId: call.callId,
      deviceId: call.deviceId,
      ...data,
    });
  }

  private info(call: ActiveCall): CallInfo {
    const { connectTimer, ...info } = call;
    void connectTimer;
    return info;
  }
}
