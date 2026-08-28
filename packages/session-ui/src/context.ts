import { getContext, setContext } from 'svelte';
import type { SessionUiActions, SessionUiModel } from './types.js';

const SESSION_UI_CONTEXT = Symbol('roomkit-session-ui');

export interface SessionUiContext {
	model: SessionUiModel;
	actions: SessionUiActions;
}

export function provideSessionUi(model: SessionUiModel, actions: SessionUiActions): void {
	setContext(SESSION_UI_CONTEXT, { model, actions });
}

export function useSessionUi(): SessionUiContext {
	return getContext<SessionUiContext>(SESSION_UI_CONTEXT);
}
