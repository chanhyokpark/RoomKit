import { mount } from 'svelte';
import App from './App.svelte';
import { config } from './lib/stores/config.svelte';
import { connection } from './lib/stores/connection.svelte';
import './app.css';

// Kiosk-grade default for every window (launcher included): no context menu.
// Dev builds and test sessions keep it so devtools stay reachable.
window.addEventListener('contextmenu', (e) => {
	if (import.meta.env.DEV || connection.isTest) return;
	e.preventDefault();
});

const target = document.getElementById('app')!;

// Config first: both the launcher (edit) and stage windows (lookup) need it.
void config.load().then(() => mount(App, { target }));
