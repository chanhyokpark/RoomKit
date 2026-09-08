import { z } from 'zod';

/**
 * Operator ↔ hintphone voice call (PeerJS). The server owns one call per
 * session; admins drive it over /admin socket events (ownership = the admin
 * socket that started/accepted it), the device side over /device events.
 * PeerJS signaling itself goes through the PeerServer mounted at `/peerjs`;
 * these payloads only carry the peer ids and ICE config.
 */

export const CallStatusSchema = z.enum(['requested', 'connecting', 'connected']);
export type CallStatus = z.infer<typeof CallStatusSchema>;

export const CallEndReasonSchema = z.enum([
  'admin_ended',
  'declined',
  'cancelled',
  'admin_disconnected',
  'device_offline',
  'device_failed',
  'session_ended',
  'timeout',
]);
export type CallEndReason = z.infer<typeof CallEndReasonSchema>;

/** Why a call action was refused (socket.io ack payloads). */
export const CallErrorReasonSchema = z.enum([
  'test_session',
  'session_not_live',
  'no_helper',
  'device_outdated',
  'device_offline',
  'busy',
  'no_call',
  'not_owner',
  'invalid',
]);
export type CallErrorReason = z.infer<typeof CallErrorReasonSchema>;

/** RTCIceServer subset; configured server-side via CALL_ICE_SERVERS. */
export const IceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof IceServerSchema>;

/** The session's single call as every admin sees it. */
export const CallInfoSchema = z.object({
  callId: z.uuid(),
  sessionId: z.uuid(),
  deviceId: z.uuid(),
  deviceName: z.string(),
  status: CallStatusSchema,
  /** /admin socket id of the owning operator; null while `requested`. */
  adminSocketId: z.string().nullable(),
  /** The owner's PeerJS id (the device calls it); null while `requested`. */
  adminPeerId: z.string().nullable(),
  /** Server-generated PeerJS id the device registers with. */
  devicePeerId: z.string(),
  /** Epoch ms; set for device-requested calls. */
  requestedAt: z.number().int().nonnegative().nullable(),
  /** Epoch ms when the call entered `connecting`. */
  startedAt: z.number().int().nonnegative().nullable(),
  /** Epoch ms when the device reported the media connection. */
  connectedAt: z.number().int().nonnegative().nullable(),
});
export type CallInfo = z.infer<typeof CallInfoSchema>;

/** /admin `call:state` payload (broadcast on every change + initial dump). */
export const AdminCallStateSchema = z.object({
  sessionId: z.uuid(),
  call: CallInfoSchema.nullable(),
  /** Set when `call` is null because a call just ended. */
  endReason: CallEndReasonSchema.optional(),
});
export type AdminCallState = z.infer<typeof AdminCallStateSchema>;

// ── /admin C→S (all answered with a CallActionAck) ─────────────────────────

export const CallStartInputSchema = z.object({
  sessionId: z.uuid(),
  deviceId: z.uuid(),
  /** The operator's already-open PeerJS id. */
  peerId: z.string().min(1),
});
export type CallStartInput = z.infer<typeof CallStartInputSchema>;

export const CallAcceptInputSchema = z.object({
  sessionId: z.uuid(),
  callId: z.uuid(),
  peerId: z.string().min(1),
});
export type CallAcceptInput = z.infer<typeof CallAcceptInputSchema>;

export const CallDeclineInputSchema = z.object({
  sessionId: z.uuid(),
  callId: z.uuid(),
});
export type CallDeclineInput = z.infer<typeof CallDeclineInputSchema>;

export const CallEndInputSchema = z.object({
  sessionId: z.uuid(),
});
export type CallEndInput = z.infer<typeof CallEndInputSchema>;

export const CallActionAckSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), call: CallInfoSchema }),
  z.object({ ok: z.literal(false), reason: CallErrorReasonSchema }),
]);
export type CallActionAck = z.infer<typeof CallActionAckSchema>;

/** /admin `call:config` ack: ICE servers the operator's Peer should use. */
export const CallConfigSchema = z.object({
  iceServers: z.array(IceServerSchema).nullable(),
});
export type CallConfig = z.infer<typeof CallConfigSchema>;

// ── /device ────────────────────────────────────────────────────────────────

/** S→C `call:state`: connect now (the device calls `adminPeerId`), or stop. */
export const DeviceCallStateSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('connecting'),
    callId: z.uuid(),
    adminPeerId: z.string(),
    devicePeerId: z.string(),
    iceServers: z.array(IceServerSchema).nullable(),
  }),
  z.object({
    status: z.literal('ended'),
    callId: z.uuid(),
    reason: CallEndReasonSchema,
  }),
]);
export type DeviceCallState = z.infer<typeof DeviceCallStateSchema>;

/** C→S `call:request` ack. */
export const CallRequestAckSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), callId: z.uuid() }),
  z.object({ ok: z.literal(false), reason: CallErrorReasonSchema }),
]);
export type CallRequestAck = z.infer<typeof CallRequestAckSchema>;

/** C→S `call:cancel`: withdraw a pending request. */
export const CallCancelSchema = z.object({ callId: z.uuid() });
export type CallCancel = z.infer<typeof CallCancelSchema>;

/** C→S `call:status`: the device's media outcome for a connecting call. */
export const CallStatusReportSchema = z.object({
  callId: z.uuid(),
  status: z.enum(['connected', 'failed']),
  /** Free-form failure detail (e.g. `mic_denied`, `peer_error:...`). */
  reason: z.string().max(200).optional(),
});
export type CallStatusReport = z.infer<typeof CallStatusReportSchema>;
