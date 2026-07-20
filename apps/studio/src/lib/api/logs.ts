import { z } from 'zod';
import { SessionLogEntrySchema, type SessionLogEntry } from '@roomkit/shared';
import { api } from './client';

export interface LogQuery {
	/** Cursor: only entries with id > afterId (ascending by id). */
	afterId?: number;
	/** Max 500, server default 100. */
	limit?: number;
}

export function listLogs(sessionId: string, query: LogQuery = {}): Promise<SessionLogEntry[]> {
	return api(`/sessions/${sessionId}/logs`, {
		query: {
			afterId: query.afterId === undefined ? undefined : String(query.afterId),
			limit: query.limit === undefined ? undefined : String(query.limit)
		},
		schema: z.array(SessionLogEntrySchema)
	});
}
