import { getContext, setContext } from 'svelte';
import type { SessionUiActions, SessionUiModel } from './types.js';

const SESSION_UI_CONTEXT = Symbol('roomkit-session-ui');

/**
 * Dashboard-level view preferences. `simple` hides everything an operator does
 * not need when the session is behaving: only calls, the timer, manual events,
 * screens, device online state and hint pushes remain.
 */
export interface SessionUiView {
	readonly simple: boolean;
	setSimple(value: boolean): void;
}

export interface SessionUiContext {
	model: SessionUiModel;
	actions: SessionUiActions;
	view: SessionUiView;
}

export function provideSessionUi(
	model: SessionUiModel,
	actions: SessionUiActions,
	view: SessionUiView
): void {
	setContext(SESSION_UI_CONTEXT, { model, actions, view });
}

export function useSessionUi(): SessionUiContext {
	return getContext<SessionUiContext>(SESSION_UI_CONTEXT);
}
