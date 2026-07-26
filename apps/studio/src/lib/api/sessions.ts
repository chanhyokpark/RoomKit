import { z } from 'zod';
import {
	SessionResponseSchema,
	SessionSchema,
	SessionSummarySchema,
	type AdjustTimerInput,
	type Command,
	type CreateSessionInput,
	type PushHintInput,
	type Session,
	type SessionResponse,
	type SessionSummary
} from '@roomkit/shared';
import { api } from './client';

export interface SessionFilters {
	themeId?: string;
	active?: boolean;
}

export function listSessions(filters: SessionFilters = {}): Promise<Session[]> {
	return api('/sessions', {
		query: {
			themeId: filters.themeId,
			active: filters.active === undefined ? undefined : String(filters.active)
		},
		schema: z.array(SessionSchema)
	});
}

export function createSession(input: CreateSessionInput): Promise<SessionResponse> {
	return api('/sessions', { method: 'POST', body: input, schema: SessionResponseSchema });
}

export function getSession(id: string): Promise<SessionResponse> {
	return api(`/sessions/${id}`, { schema: SessionResponseSchema });
}

/** Post-game analytics; the server answers 409 until the session row is ended. */
export function getSessionSummary(id: string): Promise<SessionSummary> {
	return api(`/sessions/${id}/summary`, { schema: SessionSummarySchema });
}

export function deleteSession(id: string): Promise<void> {
	return api(`/sessions/${id}`, { method: 'DELETE' });
}

export function startSession(id: string): Promise<SessionResponse> {
	return api(`/sessions/${id}/start`, { method: 'POST', schema: SessionResponseSchema });
}

export function pauseSession(id: string): Promise<SessionResponse> {
	return api(`/sessions/${id}/pause`, { method: 'POST', schema: SessionResponseSchema });
}

export function resumeSession(id: string): Promise<SessionResponse> {
	return api(`/sessions/${id}/resume`, { method: 'POST', schema: SessionResponseSchema });
}

export function endSession(id: string): Promise<SessionResponse> {
	return api(`/sessions/${id}/end`, { method: 'POST', schema: SessionResponseSchema });
}

export function adjustTimer(id: string, input: AdjustTimerInput): Promise<SessionResponse> {
	return api(`/sessions/${id}/timer`, {
		method: 'POST',
		body: input,
		schema: SessionResponseSchema
	});
}

export function switchPhase(id: string, phaseId: string): Promise<SessionResponse> {
	return api(`/sessions/${id}/phase`, {
		method: 'POST',
		body: { phaseId },
		schema: SessionResponseSchema
	});
}

export function restartPhase(id: string): Promise<SessionResponse> {
	return api(`/sessions/${id}/phase/restart`, {
		method: 'POST',
		schema: SessionResponseSchema
	});
}

export function triggerEvent(id: string, eventId: string): Promise<void> {
	return api(`/sessions/${id}/trigger`, { method: 'POST', body: { eventId } });
}

export function resetDevices(id: string): Promise<void> {
	return api(`/sessions/${id}/reset-devices`, { method: 'POST' });
}

export function pushHint(id: string, input: PushHintInput): Promise<void> {
	return api(`/sessions/${id}/hint`, { method: 'POST', body: input });
}

/** Force-terminate one in-flight event run. */
export function abortRun(id: string, runId: string): Promise<void> {
	return api(`/sessions/${id}/runs/${runId}/abort`, { method: 'POST' });
}

/**
 * One-off operator command (operation console / media stop buttons).
 * Fire-and-forget on the server — outcomes stream in via the session log.
 */
export function runSessionCommand(id: string, command: Command): Promise<void> {
	return api(`/sessions/${id}/command`, { method: 'POST', body: command });
}
