import { isTauri } from '../tauri';

export interface DeviceEntry {
	id: string;
	/** Operator-facing label for the window title / launcher list. */
	label: string;
	/** Production device code or an operator-issued test code. */
	deviceCode: string;
	/** Fullscreen kiosk lock for this device's window. */
	kiosk: boolean;
}

export interface PlayerConfig {
	serverUrl: string;
	devices: DeviceEntry[];
}

const DEFAULTS: PlayerConfig = { serverUrl: 'http://localhost:3000', devices: [] };
const WEB_KEY = 'roomkit-player.config';

/**
 * Launcher-editable settings, persisted to config.json in the app data dir
 * (tauri-plugin-store; localStorage in the browser dev harness). Saved
 * settings pre-fill the launcher on every start — the launcher always shows,
 * there is no auto-connect.
 */
class ConfigStore {
	serverUrl = $state(DEFAULTS.serverUrl);
	devices = $state<DeviceEntry[]>([]);
	loaded = $state(false);

	private tauriStore: { set(k: string, v: unknown): Promise<void>; save(): Promise<void> } | null =
		null;

	async load(): Promise<void> {
		if (isTauri()) {
			const { load } = await import('@tauri-apps/plugin-store');
			const store = await load('config.json', { autoSave: false });
			this.tauriStore = store;
			const stored = (await store.get<PlayerConfig>('config')) ?? DEFAULTS;
			this.apply(stored);
		} else {
			const raw = localStorage.getItem(WEB_KEY);
			this.apply(raw ? (JSON.parse(raw) as PlayerConfig) : DEFAULTS);
		}
		this.loaded = true;
	}

	async save(): Promise<void> {
		const snapshot: PlayerConfig = {
			serverUrl: this.serverUrl,
			devices: this.devices.map((d) => ({ ...d }))
		};
		if (this.tauriStore) {
			await this.tauriStore.set('config', snapshot);
			await this.tauriStore.save();
		} else {
			localStorage.setItem(WEB_KEY, JSON.stringify(snapshot));
		}
	}

	deviceById(id: string): DeviceEntry | undefined {
		return this.devices.find((d) => d.id === id);
	}

	addDevice(): DeviceEntry {
		const entry: DeviceEntry = {
			id: crypto.randomUUID(),
			label: `디바이스 ${this.devices.length + 1}`,
			deviceCode: '',
			kiosk: false
		};
		this.devices.push(entry);
		return entry;
	}

	removeDevice(id: string): void {
		this.devices = this.devices.filter((d) => d.id !== id);
	}

	private apply(config: PlayerConfig): void {
		this.serverUrl = config.serverUrl ?? DEFAULTS.serverUrl;
		this.devices = Array.isArray(config.devices) ? config.devices : [];
	}
}

export const config = new ConfigStore();
