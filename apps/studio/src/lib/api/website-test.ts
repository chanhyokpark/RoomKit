import { z } from 'zod';
import {
	WebsiteTestActivitySchema,
	WebsiteTestRunSchema,
	type Command,
	type CreateWebsiteTestInput,
	type UpdateWebsiteTestInput,
	type WebsiteTestActivity,
	type WebsiteTestRun,
	type WebsiteTestTimerInput
} from '@roomkit/shared';
import { api } from './client';

export function createWebsiteTest(input: CreateWebsiteTestInput): Promise<WebsiteTestRun> {
	return api('/website-test', { method: 'POST', body: input, schema: WebsiteTestRunSchema });
}

/** Active runs only — a server restart or stop drops them (nothing is saved). */
export function listWebsiteTests(themeId: string): Promise<WebsiteTestRun[]> {
	return api('/website-test', { query: { themeId }, schema: z.array(WebsiteTestRunSchema) });
}

export function getWebsiteTestActivity(runId: string): Promise<WebsiteTestActivity[]> {
	return api(`/website-test/${runId}/activity`, { schema: z.array(WebsiteTestActivitySchema) });
}

export function stopWebsiteTest(runId: string): Promise<void> {
	return api(`/website-test/${runId}`, { method: 'DELETE' });
}

export function sendWebsiteTestCommand(runId: string, command: Command): Promise<void> {
	return api(`/website-test/${runId}/command`, { method: 'POST', body: { command } });
}

export function runWebsiteTestEvent(runId: string, eventId: string): Promise<void> {
	return api(`/website-test/${runId}/run-event`, { method: 'POST', body: { eventId } });
}

export function cancelWebsiteTestRun(runId: string): Promise<void> {
	return api(`/website-test/${runId}/cancel-run`, { method: 'POST' });
}

export function reloadWebsiteTest(runId: string): Promise<void> {
	return api(`/website-test/${runId}/reload`, { method: 'POST' });
}

export function setWebsiteTestTimer(
	runId: string,
	input: WebsiteTestTimerInput
): Promise<WebsiteTestRun> {
	return api(`/website-test/${runId}/timer`, {
		method: 'POST',
		body: input,
		schema: WebsiteTestRunSchema
	});
}

export function updateWebsiteTest(
	runId: string,
	input: UpdateWebsiteTestInput
): Promise<WebsiteTestRun> {
	return api(`/website-test/${runId}`, {
		method: 'PATCH',
		body: input,
		schema: WebsiteTestRunSchema
	});
}
