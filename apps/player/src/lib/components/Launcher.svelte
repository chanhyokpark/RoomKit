<script lang="ts">
	import { config } from '../stores/config.svelte';
	import { openDeviceWindow } from '../windows';

	// Settings persist to disk but the launcher still opens on every start —
	// the operator explicitly opens device windows from here.
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	function persist() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void config.save(), 300);
	}

	function openAll() {
		for (const device of config.devices) {
			if (device.deviceCode.trim()) void openDeviceWindow(device);
		}
	}
</script>

<main class="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto p-8">
	<header>
		<h1 class="text-xl font-semibold">RoomKit Player</h1>
		<p class="mt-1 text-sm text-neutral-400">
			서버와 디바이스를 설정하고 창을 열어 시작하세요. 설정은 자동으로 저장됩니다.
		</p>
	</header>

	<label class="flex flex-col gap-1.5">
		<span class="text-sm font-medium text-neutral-300">서버 URL</span>
		<input
			class="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400"
			type="url"
			placeholder="http://localhost:3000"
			bind:value={config.serverUrl}
			oninput={persist}
		/>
	</label>

	<section class="flex flex-col gap-3">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-medium text-neutral-300">디바이스</h2>
			<div class="flex gap-2">
				<button
					class="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
					onclick={() => {
						config.addDevice();
						persist();
					}}
				>
					추가
				</button>
				<button
					class="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
					disabled={!config.devices.some((d) => d.deviceCode.trim())}
					onclick={openAll}
				>
					모두 열기
				</button>
			</div>
		</div>

		{#if config.devices.length === 0}
			<p class="rounded-md border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
				아직 디바이스가 없습니다. ‘추가’로 디바이스 코드를 등록하세요.
			</p>
		{/if}

		{#each config.devices as device (device.id)}
			<div class="flex items-end gap-2 rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
				<label class="flex w-36 flex-col gap-1">
					<span class="text-xs text-neutral-400">라벨</span>
					<input
						class="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-neutral-400"
						bind:value={device.label}
						oninput={persist}
					/>
				</label>
				<label class="flex flex-1 flex-col gap-1">
					<span class="text-xs text-neutral-400">디바이스 코드</span>
					<input
						class="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 font-mono text-sm outline-none focus:border-neutral-400"
						placeholder="프로덕션 코드 또는 테스트 코드"
						bind:value={device.deviceCode}
						oninput={persist}
					/>
				</label>
				<label class="flex items-center gap-1.5 pb-2 text-xs text-neutral-400">
					<input type="checkbox" bind:checked={device.kiosk} onchange={persist} />
					키오스크
				</label>
				<button
					class="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
					disabled={!device.deviceCode.trim()}
					onclick={() => void openDeviceWindow(device)}
				>
					열기
				</button>
				<button
					class="rounded-md border border-neutral-700 px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
					aria-label="디바이스 삭제"
					onclick={() => {
						config.removeDevice(device.id);
						persist();
					}}
				>
					✕
				</button>
			</div>
		{/each}
	</section>
</main>
