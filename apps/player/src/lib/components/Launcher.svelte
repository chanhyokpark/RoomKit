<script lang="ts">
	import { onMount } from 'svelte';
	import logo from '../assets/logo.svg';
	import { auth } from '../stores/auth.svelte';
	import { config } from '../stores/config.svelte';
	import { player } from '../stores/player.svelte';
	import { testSetup } from '../stores/test-setup.svelte';
	import { isMobile } from '../tauri';
	import { openDeviceWindow } from '../windows';

	// Single-window platforms (Android): opening a device replaces the
	// launcher, so batch-open is hidden and a notice explains the escape path.
	// The test tab (multi-window + debug window) is desktop-only.
	let mobile = $state(false);
	void isMobile().then((m) => (mobile = m));

	let tab = $state<'prod' | 'test'>('prod');
	let loginId = $state('');
	let loginPassword = $state('');

	// Settings persist to disk but the launcher still opens on every start —
	// the operator explicitly opens device windows from here.
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	function persist() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void config.save(), 300);
	}

	/** Server URL / player name edits also re-register on the server. */
	function persistAndReconnect() {
		persist();
		player.reconnectSoon();
	}

	// The launcher registers itself so studio can target this player for
	// auto-started test sessions; stored admin credentials log in silently.
	onMount(() => {
		player.connect();
		if (config.auth) {
			void auth.relogin().then((ok) => {
				if (ok) void testSetup.loadThemes();
			});
		}
		return () => player.disconnect();
	});

	const statusLabel = $derived(
		player.status === 'connected'
			? '서버에 연결됨'
			: player.status === 'connecting'
				? '연결 중…'
				: '오프라인'
	);

	const testConfig = $derived(
		config.selectedThemeId ? config.testConfigFor(config.selectedThemeId) : null
	);

	function openAll() {
		for (const device of config.devices) {
			if (device.deviceCode.trim()) void openDeviceWindow(device);
		}
	}

	async function submitLogin(event: SubmitEvent) {
		event.preventDefault();
		if (await auth.login(loginId.trim(), loginPassword)) {
			loginPassword = '';
			void testSetup.loadThemes();
		}
	}

	function toggleDevice(deviceId: string, checked: boolean) {
		if (!testConfig) return;
		if (checked) {
			if (!testConfig.deviceIds.includes(deviceId)) testConfig.deviceIds.push(deviceId);
			testSetup.syncAutoOverrides(config.selectedThemeId);
		} else {
			testConfig.deviceIds = testConfig.deviceIds.filter((id) => id !== deviceId);
		}
		persist();
	}

	function selectAllDevices() {
		if (!testConfig) return;
		testConfig.deviceIds = testSetup.devices.map((d) => d.id);
		testSetup.syncAutoOverrides(config.selectedThemeId);
		persist();
	}

	function overridePlaceholder(websiteId: string): string {
		const site = testSetup.websites.find((w) => w.id === websiteId);
		return site?.defaultUrl ? `기본: ${site.defaultUrl}` : '대체 URL (비우면 치환 안 함)';
	}

	const inputClass =
		'rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400';
	const smallInputClass =
		'rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-neutral-400';
	const primaryBtn =
		'rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40';
	const ghostBtn = 'rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800';
</script>

<main class="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto p-8">
	<header class="flex items-center gap-3">
		<img src={logo} alt="RoomKit" class="size-10 rounded-lg" />
		<div>
			<h1 class="text-xl font-semibold">RoomKit Player</h1>
			<p class="mt-0.5 text-sm text-neutral-400">
				서버와 디바이스를 설정하고 창을 열어 시작하세요. 설정은 자동으로 저장됩니다.
			</p>
		</div>
	</header>

	<label class="flex flex-col gap-1.5">
		<span class="text-sm font-medium text-neutral-300">서버 URL</span>
		<input
			class={inputClass}
			type="url"
			placeholder="http://localhost:3000"
			bind:value={config.serverUrl}
			oninput={persistAndReconnect}
		/>
	</label>

	<label class="flex flex-col gap-1.5">
		<span class="flex items-center justify-between text-sm font-medium text-neutral-300">
			플레이어 이름
			<span class="flex items-center gap-1.5 text-xs font-normal text-neutral-400">
				<span
					class="h-2 w-2 rounded-full {player.status === 'connected'
						? 'bg-emerald-400'
						: player.status === 'connecting'
							? 'bg-amber-400'
							: 'bg-neutral-600'}"
				></span>
				{statusLabel}
			</span>
		</span>
		<input class={inputClass} bind:value={config.playerName} oninput={persistAndReconnect} />
	</label>

	{#if mobile}
		<p class="rounded-md border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
			모바일에서는 창을 하나만 열 수 있습니다. 디바이스를 열면 이 화면이 스테이지로 전환되며,
			런처로 돌아오려면 앱을 완전히 종료했다가 다시 실행하세요.
		</p>
	{:else}
		<nav class="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900/60 p-1">
			<button
				class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium {tab === 'prod'
					? 'bg-neutral-100 text-neutral-900'
					: 'text-neutral-400 hover:text-neutral-200'}"
				onclick={() => (tab = 'prod')}
			>
				실제
			</button>
			<button
				class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium {tab === 'test'
					? 'bg-neutral-100 text-neutral-900'
					: 'text-neutral-400 hover:text-neutral-200'}"
				onclick={() => (tab = 'test')}
			>
				테스트
			</button>
		</nav>
	{/if}

	{#if mobile || tab === 'prod'}
		{#if player.lastTestStart}
			<p
				class="rounded-md border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300"
			>
				테스트 세션이 시작되어 디바이스 창 {player.lastTestStart.devices.length}개를 열었습니다.
			</p>
		{/if}

		<section class="flex flex-col gap-3">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-medium text-neutral-300">디바이스</h2>
				<div class="flex gap-2">
					<button
						class={ghostBtn}
						onclick={() => {
							config.addDevice();
							persist();
						}}
					>
						추가
					</button>
					{#if !mobile}
						<button
							class={primaryBtn}
							disabled={!config.devices.some((d) => d.deviceCode.trim())}
							onclick={openAll}
						>
							모두 열기
						</button>
					{/if}
				</div>
			</div>

			{#if config.devices.length === 0}
				<p
					class="rounded-md border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500"
				>
					아직 디바이스가 없습니다. ‘추가’로 디바이스 코드를 등록하세요.
				</p>
			{/if}

			{#each config.devices as device (device.id)}
				<div class="flex items-end gap-2 rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
					<label class="flex w-36 flex-col gap-1">
						<span class="text-xs text-neutral-400">라벨</span>
						<input class={smallInputClass} bind:value={device.label} oninput={persist} />
					</label>
					<label class="flex flex-1 flex-col gap-1">
						<span class="text-xs text-neutral-400">디바이스 코드</span>
						<input
							class="{smallInputClass} font-mono"
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
						class={primaryBtn}
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
	{:else}
		<!-- 테스트 탭: 스튜디오 없이 이 기기에서 테마를 테스트합니다. -->
		{#if !auth.loggedIn}
			<form class="flex flex-col gap-3" onsubmit={submitLogin}>
				<p class="text-sm text-neutral-400">
					테스트 기능은 서버 관리자 계정이 필요합니다. 로그인하면 이 기기에 저장됩니다.
				</p>
				<div class="flex gap-2">
					<input class="{inputClass} flex-1" placeholder="아이디" bind:value={loginId} />
					<input
						class="{inputClass} flex-1"
						type="password"
						placeholder="비밀번호"
						bind:value={loginPassword}
					/>
					<button class={primaryBtn} type="submit" disabled={auth.status === 'pending'}>
						로그인
					</button>
				</div>
				{#if auth.error}
					<p class="text-xs text-red-400">{auth.error}</p>
				{/if}
			</form>
		{:else}
			<div class="flex items-center justify-between text-xs text-neutral-400">
				<span>관리자로 로그인됨{config.auth ? ` (${config.auth.id})` : ''}</span>
				<button class="underline hover:text-neutral-200" onclick={() => void auth.logout()}>
					로그아웃
				</button>
			</div>

			<label class="flex flex-col gap-1.5">
				<span class="text-sm font-medium text-neutral-300">테마</span>
				<select
					class={inputClass}
					value={config.selectedThemeId}
					onchange={(e) => void testSetup.selectTheme(e.currentTarget.value)}
				>
					<option value="">테마를 선택하세요</option>
					{#each testSetup.themes as theme (theme.id)}
						<option value={theme.id}>{theme.name}</option>
					{/each}
				</select>
			</label>

			{#if testSetup.error}
				<p class="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
					{testSetup.error}
				</p>
			{/if}

			{#if config.selectedThemeId && testConfig}
				<section class="flex flex-col gap-3">
					<div class="flex items-center justify-between">
						<h2 class="text-sm font-medium text-neutral-300">실행할 디바이스</h2>
						<button class="text-xs text-neutral-400 underline hover:text-neutral-200" onclick={selectAllDevices}>
							전체 선택
						</button>
					</div>
					{#if testSetup.loading}
						<p class="text-sm text-neutral-500">불러오는 중…</p>
					{:else if testSetup.devices.length === 0}
						<p
							class="rounded-md border border-dashed border-neutral-700 p-4 text-center text-sm text-neutral-500"
						>
							이 테마에는 디바이스 애셋이 없습니다.
						</p>
					{:else}
						<div class="flex flex-col gap-1.5">
							{#each testSetup.devices as device (device.id)}
								<label
									class="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm"
								>
									<input
										type="checkbox"
										checked={testConfig.deviceIds.includes(device.id)}
										onchange={(e) => toggleDevice(device.id, e.currentTarget.checked)}
									/>
									<span>{device.displayName}</span>
									<span class="text-xs text-neutral-500">{device.name}</span>
									{#if device.startWebsiteId}
										<span class="ml-auto text-xs text-neutral-500">시작 웹페이지 있음</span>
									{/if}
								</label>
							{/each}
						</div>
					{/if}

					<div class="mt-2 flex items-center justify-between">
						<h2 class="text-sm font-medium text-neutral-300">웹사이트 URL 대체</h2>
						<button
							class={ghostBtn}
							onclick={() => {
								testConfig.overrides.push({ websiteId: '', url: '' });
								persist();
							}}
						>
							행 추가
						</button>
					</div>
					<p class="text-xs text-neutral-500">
						선택한 웹사이트 애셋을 이 세션에서만 다른 주소(예: 로컬 개발 서버)로 바꿉니다. URL을
						비워두면 치환하지 않습니다.
					</p>
					{#each testConfig.overrides as override, i (i)}
						<div class="flex items-center gap-2">
							<select
								class="{smallInputClass} w-44"
								bind:value={override.websiteId}
								onchange={persist}
							>
								<option value="">웹사이트 선택</option>
								{#each testSetup.websites as site (site.id)}
									<option value={site.id}>{site.name}</option>
								{/each}
							</select>
							<input
								class="{smallInputClass} flex-1 font-mono"
								placeholder={override.websiteId
									? overridePlaceholder(override.websiteId)
									: '대체 URL (비우면 치환 안 함)'}
								bind:value={override.url}
								oninput={persist}
							/>
							<button
								class="rounded-md border border-neutral-700 px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
								aria-label="대체 삭제"
								onclick={() => {
									testConfig.overrides.splice(i, 1);
									persist();
								}}
							>
								✕
							</button>
						</div>
					{/each}

					<button
						class="{primaryBtn} mt-2 py-2"
						disabled={testConfig.deviceIds.length === 0 || testSetup.starting}
						onclick={() => void testSetup.start()}
					>
						{testSetup.starting ? '시작 중…' : '테스트 시작'}
					</button>
					<p class="text-xs text-neutral-500">
						선택한 디바이스 창과 디버그 창이 열립니다. 세션 시작은 디버그 창에서 합니다. 모든
						디바이스 창을 닫으면 세션은 잠시 후 자동 종료됩니다.
					</p>
				</section>
			{/if}
		{/if}
	{/if}
</main>
