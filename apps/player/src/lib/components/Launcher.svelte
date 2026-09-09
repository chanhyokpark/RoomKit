<script lang="ts">
	import { onMount } from 'svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Empty from '$lib/components/ui/empty';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Spinner } from '$lib/components/ui/spinner';
	import * as Tabs from '$lib/components/ui/tabs';
	import logo from '../assets/logo.svg';
	import { listenForAppLinks } from '../deep-link';
	import { warmUpMicrophone } from '../mic';
	import { auth } from '../stores/auth.svelte';
	import { config } from '../stores/config.svelte';
	import { launch } from '../stores/launch.svelte';
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
	/** Test tab: paste a session id (from `rk dev --no-open` or Studio) to open its windows. */
	let openSessionId = $state('');

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
		// Raise the microphone permission prompt now (every platform), so an
		// operator call later never has to prompt inside a kiosk stage window.
		void warmUpMicrophone();
		if (config.auth) {
			void auth.relogin().then((ok) => {
				if (ok) void testSetup.loadThemes();
			});
		}
		// App links (roomkit-player://…) from Studio / `rk dev`: the launch
		// store opens the session's windows, asking first when the link names
		// another server or no admin login is available.
		let unlisten: (() => void) | null = null;
		void listenForAppLinks((link) => launch.handle(link)).then((stop) => (unlisten = stop));
		return () => {
			unlisten?.();
			player.disconnect();
		};
	});

	// A pending link that only waits for a login is served right after one.
	$effect(() => {
		if (auth.loggedIn && launch.pending && !launch.pending.serverMismatch) void launch.resume();
	});

	const statusLabel = $derived(
		player.status === 'connected'
			? '서버에 연결됨'
			: player.status === 'connecting'
				? '연결 중…'
				: '오프라인'
	);

	// Read-only lookup: the entry is created by testSetup.selectTheme /
	// loadThemes. Creating it here would mutate state inside a $derived.
	const testConfig = $derived(
		config.selectedThemeId ? (config.testConfigs[config.selectedThemeId] ?? null) : null
	);

	const selectedThemeName = $derived(
		testSetup.themes.find((t) => t.id === config.selectedThemeId)?.name ?? null
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

	async function submitOpenSession(event: SubmitEvent) {
		event.preventDefault();
		if (await launch.openSession(openSessionId)) openSessionId = '';
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

	function websiteName(websiteId: string): string | null {
		return testSetup.websites.find((w) => w.id === websiteId)?.name ?? null;
	}

	function overridePlaceholder(websiteId: string): string {
		const site = testSetup.websites.find((w) => w.id === websiteId);
		return site?.defaultUrl ? `기본: ${site.defaultUrl}` : '대체 URL (비우면 치환 안 함)';
	}
</script>

{#snippet prodTab()}
	{#if player.lastTestStart}
		<Alert.Root>
			<Alert.Description>
				테스트 세션이 시작되어 디바이스 창 {player.lastTestStart.devices.length}개를 열었습니다.
			</Alert.Description>
		</Alert.Root>
	{/if}

	<section class="flex flex-col gap-3">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-medium">디바이스</h2>
			<div class="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					onclick={() => {
						config.addDevice();
						persist();
					}}
				>
					추가
				</Button>
				{#if !mobile}
					<Button
						size="sm"
						disabled={!config.devices.some((d) => d.deviceCode.trim())}
						onclick={openAll}
					>
						모두 열기
					</Button>
				{/if}
			</div>
		</div>

		{#if config.devices.length === 0}
			<Empty.Root class="border p-8">
				<Empty.Header>
					<Empty.Title class="text-sm">아직 디바이스가 없습니다</Empty.Title>
					<Empty.Description>‘추가’로 디바이스 코드를 등록하세요.</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{/if}

		{#each config.devices as device (device.id)}
			<!-- Narrow screens stack the fields so the code input keeps full width;
			     from sm: up everything sits on one row. -->
			<div class="flex flex-col gap-2 rounded-md border bg-card p-3 sm:flex-row sm:items-end">
				<div class="flex flex-col gap-1 sm:w-36">
					<Label for="device-label-{device.id}" class="text-xs text-muted-foreground">라벨</Label>
					<Input id="device-label-{device.id}" bind:value={device.label} oninput={persist} />
				</div>
				<div class="flex min-w-0 flex-col gap-1 sm:flex-1">
					<Label for="device-code-{device.id}" class="text-xs text-muted-foreground">
						디바이스 코드
					</Label>
					<Input
						id="device-code-{device.id}"
						class="font-mono"
						placeholder="프로덕션 코드 또는 테스트 코드"
						bind:value={device.deviceCode}
						oninput={persist}
					/>
				</div>
				<div class="flex items-center gap-2 sm:contents">
					<div class="flex items-center gap-1.5 sm:self-center sm:pt-4">
						<Checkbox
							id="device-kiosk-{device.id}"
							bind:checked={device.kiosk}
							onCheckedChange={persist}
						/>
						<Label
							for="device-kiosk-{device.id}"
							class="text-xs font-normal text-muted-foreground"
						>
							키오스크
						</Label>
					</div>
					<Button
						class="ml-auto sm:ml-0"
						disabled={!device.deviceCode.trim()}
						onclick={() => void openDeviceWindow(device)}
					>
						열기
					</Button>
					<Button
						variant="ghost"
						size="icon"
						aria-label="디바이스 삭제"
						onclick={() => {
							config.removeDevice(device.id);
							persist();
						}}
					>
						<XIcon />
					</Button>
				</div>
			</div>
		{/each}
	</section>
{/snippet}

{#snippet testTab()}
	<!-- 테스트 탭: 스튜디오 없이 이 기기에서 테마를 테스트합니다. -->
	{#if !auth.loggedIn}
		<form class="flex flex-col gap-3" onsubmit={submitLogin}>
			<p class="text-sm text-muted-foreground">
				테스트 기능은 서버 관리자 계정이 필요합니다. 로그인하면 이 기기에 저장됩니다.
			</p>
			<div class="flex flex-col gap-2 sm:flex-row">
				<Input class="sm:flex-1" placeholder="아이디" bind:value={loginId} />
				<Input class="sm:flex-1" type="password" placeholder="비밀번호" bind:value={loginPassword} />
				<Button type="submit" disabled={auth.status === 'pending'}>로그인</Button>
			</div>
			{#if auth.error}
				<p class="text-xs text-destructive">{auth.error}</p>
			{/if}
		</form>
	{:else}
		<div class="flex items-center justify-between text-xs text-muted-foreground">
			<span>관리자로 로그인됨{config.auth ? ` (${config.auth.id})` : ''}</span>
			<Button
				variant="link"
				size="sm"
				class="h-auto p-0 text-xs text-muted-foreground"
				onclick={() => void auth.logout()}
			>
				로그아웃
			</Button>
		</div>

		<form class="flex flex-col gap-1.5" onsubmit={submitOpenSession}>
			<Label for="open-session-id" class="text-sm font-medium">세션 ID로 열기</Label>
			<div class="flex gap-2">
				<Input
					id="open-session-id"
					class="min-w-0 flex-1 font-mono"
					placeholder="rk dev / Studio 가 만든 테스트 세션 id"
					bind:value={openSessionId}
					disabled={launch.status === 'opening'}
				/>
				<Button type="submit" variant="outline" disabled={!openSessionId.trim() || launch.status === 'opening'}>
					{#if launch.status === 'opening'}<Spinner data-icon="inline-start" />{/if}
					열기
				</Button>
			</div>
			<p class="text-xs text-muted-foreground">
				이미 만들어진 테스트 세션의 장치 창과 디버그 창을 엽니다. 앱 링크
				(<code>roomkit-player://</code>)가 동작하지 않을 때 사용하세요.
			</p>
			{#if launch.status === 'error' && !launch.pending}
				<p class="text-xs text-destructive">{launch.error}</p>
			{/if}
		</form>

		<Field.Field>
			<Field.FieldLabel>테마</Field.FieldLabel>
			<Select.Root
				type="single"
				value={config.selectedThemeId}
				onValueChange={(v) => void testSetup.selectTheme(v)}
			>
				<Select.Trigger class="w-full">
					{selectedThemeName ?? '테마를 선택하세요'}
				</Select.Trigger>
				<Select.Content>
					{#each testSetup.themes as theme (theme.id)}
						<Select.Item value={theme.id} label={theme.name}>{theme.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</Field.Field>

		{#if testSetup.error}
			<Alert.Root variant="destructive">
				<Alert.Description>{testSetup.error}</Alert.Description>
			</Alert.Root>
		{/if}

		{#if config.selectedThemeId && testConfig}
			<section class="flex flex-col gap-3">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-medium">실행할 디바이스</h2>
					<Button
						variant="link"
						size="sm"
						class="h-auto p-0 text-xs text-muted-foreground"
						onclick={selectAllDevices}
					>
						전체 선택
					</Button>
				</div>
				{#if testSetup.loading}
					<p class="text-sm text-muted-foreground">불러오는 중…</p>
				{:else if testSetup.devices.length === 0}
					<Empty.Root class="border p-6">
						<Empty.Header>
							<Empty.Description>이 테마에는 디바이스 애셋이 없습니다.</Empty.Description>
						</Empty.Header>
					</Empty.Root>
				{:else}
					<div class="flex flex-col gap-1.5">
						{#each testSetup.devices as device (device.id)}
							<div class="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
								<Checkbox
									id="test-device-{device.id}"
									checked={testConfig.deviceIds.includes(device.id)}
									onCheckedChange={(checked) => toggleDevice(device.id, checked === true)}
								/>
								<Label for="test-device-{device.id}" class="text-sm font-normal">
									{device.displayName}
								</Label>
								<span class="text-xs text-muted-foreground">{device.name}</span>
								{#if device.startWebsiteId}
									<span class="ml-auto text-xs text-muted-foreground">시작 웹페이지 있음</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<div class="mt-2 flex items-center justify-between">
					<h2 class="text-sm font-medium">웹사이트 URL 대체</h2>
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							testConfig.overrides.push({ websiteId: '', url: '' });
							persist();
						}}
					>
						행 추가
					</Button>
				</div>
				<p class="text-xs text-muted-foreground">
					선택한 웹사이트 애셋을 이 세션에서만 다른 주소(예: 로컬 개발 서버)로 바꿉니다. URL을
					비워두면 치환하지 않습니다.
				</p>
				{#each testConfig.overrides as override, i (i)}
					<div class="flex flex-wrap items-center gap-2">
						<Select.Root type="single" bind:value={override.websiteId} onValueChange={persist}>
							<Select.Trigger class="w-full sm:w-44">
								{websiteName(override.websiteId) ?? '웹사이트 선택'}
							</Select.Trigger>
							<Select.Content>
								{#each testSetup.websites as site (site.id)}
									<Select.Item value={site.id} label={site.name}>{site.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<Input
							class="min-w-0 flex-1 font-mono"
							placeholder={override.websiteId
								? overridePlaceholder(override.websiteId)
								: '대체 URL (비우면 치환 안 함)'}
							bind:value={override.url}
							oninput={persist}
						/>
						<Button
							variant="ghost"
							size="icon"
							aria-label="대체 삭제"
							onclick={() => {
								testConfig.overrides.splice(i, 1);
								persist();
							}}
						>
							<XIcon />
						</Button>
					</div>
				{/each}

				<Button
					class="mt-2"
					disabled={testConfig.deviceIds.length === 0 || testSetup.starting}
					onclick={() => void testSetup.start()}
				>
					{#if testSetup.starting}<Spinner data-icon="inline-start" />{/if}
					{testSetup.starting ? '시작 중…' : '테스트 시작'}
				</Button>
				<p class="text-xs text-muted-foreground">
					선택한 디바이스 창과 디버그 창이 열립니다. 세션 시작은 디버그 창에서 합니다. 모든
					디바이스 창을 닫으면 세션은 잠시 후 자동 종료됩니다.
				</p>
			</section>
		{/if}
	{/if}
{/snippet}

<main class="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto p-4 sm:p-8">
	<header class="flex items-center gap-3">
		<img src={logo} alt="RoomKit" class="size-10 rounded-lg" />
		<div>
			<h1 class="text-xl font-semibold">RoomKit Player</h1>
			<p class="mt-0.5 text-sm text-muted-foreground">
				서버와 디바이스를 설정하고 창을 열어 시작하세요. 설정은 자동으로 저장됩니다.
			</p>
		</div>
	</header>

	<Field.FieldGroup class="gap-6">
		<Field.Field>
			<Field.FieldLabel for="server-url">서버 URL</Field.FieldLabel>
			<Input
				id="server-url"
				type="url"
				placeholder="http://localhost:3000"
				bind:value={config.serverUrl}
				oninput={persistAndReconnect}
			/>
		</Field.Field>

		<Field.Field>
			<div class="flex items-center justify-between">
				<Field.FieldLabel for="player-name">플레이어 이름</Field.FieldLabel>
				<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<span
						class="h-2 w-2 rounded-full {player.status === 'connected'
							? 'bg-emerald-400'
							: player.status === 'connecting'
								? 'bg-amber-400'
								: 'bg-muted'}"
					></span>
					{statusLabel}
				</span>
			</div>
			<Input id="player-name" bind:value={config.playerName} oninput={persistAndReconnect} />
		</Field.Field>
	</Field.FieldGroup>

	{#if launch.pending}
		<Alert.Root>
			<Alert.Title>앱 링크</Alert.Title>
			<Alert.Description class="flex flex-col gap-2">
				{#if launch.pending.serverMismatch}
					<span>
						링크가 다른 서버를 가리킵니다: <code class="font-mono">{launch.pending.link.server}</code>.
						서버 URL을 바꾸고 계속할까요?
					</span>
					<div class="flex gap-2">
						<Button size="sm" onclick={() => void launch.accept()}>서버 전환 후 열기</Button>
						<Button size="sm" variant="outline" onclick={() => launch.dismiss()}>무시</Button>
					</div>
				{:else if launch.pending.link.action === 'test'}
					<span>
						테스트 세션 <code class="font-mono">{launch.pending.link.sessionId.slice(0, 8)}…</code>
						을 열려면 관리자 로그인이 필요합니다.
						{#if mobile}
							설정에 저장된 관리자 계정이 없습니다.
						{:else}
							테스트 탭에서 로그인하면 바로 열립니다.
						{/if}
					</span>
					<div class="flex gap-2">
						{#if !mobile}
							<Button size="sm" onclick={() => (tab = 'test')}>테스트 탭으로</Button>
						{/if}
						<Button size="sm" variant="outline" onclick={() => launch.dismiss()}>무시</Button>
					</div>
				{/if}
			</Alert.Description>
		</Alert.Root>
	{:else if launch.status === 'error' && launch.error}
		<Alert.Root variant="destructive">
			<Alert.Title>앱 링크</Alert.Title>
			<Alert.Description class="flex items-center justify-between gap-2">
				<span>{launch.error}</span>
				<Button size="sm" variant="outline" onclick={() => launch.dismiss()}>닫기</Button>
			</Alert.Description>
		</Alert.Root>
	{:else if launch.status === 'done' && launch.lastSessionId}
		<Alert.Root>
			<Alert.Description>
				앱 링크로 테스트 세션 <code class="font-mono">{launch.lastSessionId.slice(0, 8)}…</code>
				의 창을 열었습니다.
			</Alert.Description>
		</Alert.Root>
	{/if}

	{#if mobile}
		<Alert.Root>
			<Alert.Description>
				모바일에서는 창을 하나만 열 수 있습니다. 디바이스를 열면 이 화면이 스테이지로 전환되며,
				런처로 돌아오려면 앱을 완전히 종료했다가 다시 실행하세요.
			</Alert.Description>
		</Alert.Root>
		{@render prodTab()}
	{:else}
		<Tabs.Root bind:value={tab}>
			<Tabs.List class="w-full">
				<Tabs.Trigger value="prod" class="flex-1">실제</Tabs.Trigger>
				<Tabs.Trigger value="test" class="flex-1">테스트</Tabs.Trigger>
			</Tabs.List>
			<Tabs.Content value="prod" class="flex flex-col gap-6 pt-3">
				{@render prodTab()}
			</Tabs.Content>
			<Tabs.Content value="test" class="flex flex-col gap-4 pt-3">
				{@render testTab()}
			</Tabs.Content>
		</Tabs.Root>
	{/if}
</main>
