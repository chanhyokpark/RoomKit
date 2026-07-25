import { mount } from 'svelte';
import App from './App.svelte';
import { config } from './lib/stores/config.svelte';
import './app.css';

// Kiosk-grade default for every window (launcher included): no context menu.
window.addEventListener('contextmenu', (e) => e.preventDefault());

const target = document.getElementById('app')!;

// Config first: both the launcher (edit) and stage windows (lookup) need it.
void config.load().then(() => mount(App, { target }));
