<script lang="ts">
	import { untrack } from 'svelte';
	import { PUBLIC_API_URL } from '$env/static/public';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import { toast } from 'svelte-sonner';
	import { playerTestLink, type TestDeviceCode } from '@roomkit/shared';
	import { toastApiError } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Spinner } from '$lib/components/ui/spinner';
	import * as Tabs from '$lib/components/ui/tabs';
	import { createSession } from '$lib/api/sessions';
	import { useOperationData } from './operation-data.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const data = useOperationData();

	interface CodeDraft {
		deviceId: string;
		label: string;
		code: string;
	}

	/**
	 * `link`: mint codes here and hand the session to the Player app on this
	 * computer via a `roomkit-player://` link (default). `player`: a connected
	 * launcher opens the windows itself. `manual`: operator-typed codes.
	 */
	let tab = $state<'link' | 'player' | 'manual'>('link');
	let selectedPlayerId = $state<string | null>(null);
	let drafts = $state<CodeDraft[]>([]);
	let busy = $state(false);
	let createdId = $state<string | null>(null);
	let createdCodes = $state<TestDeviceCode[]>([]);
	let createdVia = $state<'link' | 'player' | 'manual'>('link');

	// No 0/1/l/o — codes get read aloud and typed on devices.
	const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

	function suggestCode(): string {
		let code = '';
		for (let i = 0; i < 6; i++) {
			code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
		}
		return code;
	}

	// Per-theme deviceId → code map, so testers can keep their devices paired
	// with the same codes across sessions.
	const storageKey = $derived(`roomkit:test-codes:${data.themeId}`);

	function loadSavedCodes(): Record<string, string> {
		try {
			const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '');
			if (parsed === null || typeof parsed !== 'object') return {};
			return Object.fromEntries(
				Object.entries(parsed).filter(([, code]) => typeof code === 'string' && code !== '')
			);
		} catch {
			return {};
		}
	}

	function saveCodes(entries: CodeDraft[]): void {
		try {
			localStorage.setItem(
				storageKey,
				JSON.stringify(Object.fromEntries(entries.map((d) => [d.deviceId, d.code])))
			);
		} catch {
			// Storage full or unavailable — reuse is best-effort.
		}
	}

	const trimmed = $derived(drafts.map((d) => ({ ...d, code: d.code.trim() })));
	const validationError = $derived.by(() => {
		if (tab === 'player') {
			return selectedPlayerId === null ? '플레이어를 선택하세요.' : null;
		}
		if (tab === 'link') return null;
		if (trimmed.some((d) => d.code === '')) return '모든 장치에 코드를 입력하세요.';
		if (new Set(trimmed.map((d) => d.code)).size !== trimmed.length) return '코드가 중복됩니다.';
		return null;
	});

	// A selected player that disconnects while the dialog is open must not stay
	// selectable.
	$effect(() => {
		if (selectedPlayerId && !data.playersById.has(selectedPlayerId)) {
			selectedPlayerId = null;
		}
	});

	// bits-ui only fires onOpenChange for internally-triggered changes, and this
	// dialog is opened by external state assignment — initialize on open here.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			createdId = null;
			createdCodes = [];
			createdVia = 'link';
			tab = 'link';
			selectedPlayerId = data.players[0]?.playerId ?? null;
			const saved = loadSavedCodes();
			drafts = data.devices.map((device) => ({
				deviceId: device.id,
				label: device.data.displayName || device.name,
				code: saved[device.id] ?? suggestCode()
			}));
		});
	});

	async function handleCreate(): Promise<void> {
		if (busy || validationError) return;
		busy = true;
		try {
			const via = tab;
			// The link tab reuses the saved per-device codes (or the suggested
			// ones) so a tester's paired devices keep working across sessions.
			const codes =
				via === 'link'
					? drafts.map((d) => ({ ...d, code: d.code.trim() || suggestCode() }))
					: trimmed;
			const session = await createSession(
				via === 'player'
					? { themeId: data.themeId, mode: 'test', playerId: selectedPlayerId! }
					: {
							themeId: data.themeId,
							mode: 'test',
							deviceCodes: codes.map((d) => ({ deviceId: d.deviceId, code: d.code }))
						}
			);
			createdId = session.id;
			createdCodes = session.testDeviceCodes ?? [];
			createdVia = via;
			if (via !== 'player') saveCodes(codes);
			await data.refreshSessions();
			data.select(session.id);
			toast.success('테스트 세션을 만들었습니다.');
			if (via === 'link') {
				// Hand off to the Player app on this computer. The browser keeps
				// this page; the OS routes the scheme to Player.
				window.location.href = playerTestLink(PUBLIC_API_URL, session.id);
			}
		} catch (err) {
			toastApiError(err, '테스트 세션 생성에 실패했습니다.');
		} finally {
			busy = false;
		}
	}

	async function copyCode(code: string): Promise<void> {
		await navigator.clipboard.writeText(code);
		toast.success('코드가 복사되었습니다.');
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>테스트 세션 만들기</Dialog.Title>
			<Dialog.Description>
				이 컴퓨터의 Player 앱에서 바로 열거나, 연결된 플레이어에서 자동으로 시작하거나, 장치별
				테스트 코드를 직접 입력하세요.
			</Dialog.Description>
		</Dialog.Header>
		{#if createdId}
			{#if createdVia === 'player'}
				<p class="text-sm text-muted-foreground">
					플레이어에서 디바이스 창이 자동으로 열렸습니다. 생성된 코드:
				</p>
			{:else if createdVia === 'link'}
				<p class="text-sm text-muted-foreground">
					Player 앱으로 세션을 넘겼습니다. 앱이 열리지 않으면 아래 코드를 장치에 직접 입력하세요.
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">코드를 장치에 입력하세요.</p>
			{/if}
			<div class="flex flex-col gap-1.5">
				{#each createdCodes as entry (entry.deviceId)}
					<div class="flex items-center gap-2 rounded-md border p-2">
						<span class="flex-1 truncate text-sm">{entry.displayName || entry.deviceName}</span>
						<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{entry.code}</code>
						<Button
							variant="ghost"
							size="icon"
							aria-label="코드 복사"
							onclick={() => copyCode(entry.code)}
						>
							<CopyIcon />
						</Button>
					</div>
				{/each}
			</div>
			<Dialog.Footer>
				<Button onclick={() => (open = false)}>닫기</Button>
			</Dialog.Footer>
		{:else}
			<Tabs.Root bind:value={tab}>
				<Tabs.List class="w-full">
					<Tabs.Trigger value="link" class="flex-1">Player 앱</Tabs.Trigger>
					<Tabs.Trigger value="player" class="flex-1">연결된 플레이어</Tabs.Trigger>
					<Tabs.Trigger value="manual" class="flex-1">직접 입력</Tabs.Trigger>
				</Tabs.List>
				<Tabs.Content value="link" class="flex flex-col gap-1.5 pt-2">
					<p class="text-xs text-muted-foreground">
						테스트 코드가 자동 발급되고, 이 컴퓨터에 설치된 Player 앱이 앱 링크로 열려 장치 창과
						디버그 창을 띄웁니다. Player 는 <code class="font-mono">{PUBLIC_API_URL}</code> 서버에 연결합니다.
					</p>
					{#if drafts.length === 0}
						<p class="py-4 text-center text-sm text-muted-foreground">
							이 테마에 장치 애셋이 없습니다.
						</p>
					{:else}
						<p class="text-xs text-muted-foreground">
							장치 {drafts.length}개: {drafts.map((d) => d.label).join(', ')}
						</p>
					{/if}
				</Tabs.Content>
				<Tabs.Content value="player" class="flex flex-col gap-1.5 pt-2">
					{#if data.players.length === 0}
						<p class="py-4 text-center text-sm text-muted-foreground">
							연결된 플레이어가 없습니다.<br />
							플레이어 앱에서 서버에 연결하면 여기에 표시됩니다.
						</p>
					{:else}
						<p class="text-xs text-muted-foreground">
							선택한 플레이어에 테스트 코드가 자동 발급되고 디바이스 창이 열립니다.
						</p>
						{#each data.players as p (p.playerId)}
							<button
								type="button"
								class="flex items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-accent {selectedPlayerId ===
								p.playerId
									? 'border-primary bg-accent'
									: ''}"
								disabled={busy}
								onclick={() => (selectedPlayerId = p.playerId)}
							>
								<MonitorIcon class="size-4 shrink-0 text-muted-foreground" />
								<span class="flex-1 truncate">{p.playerName}</span>
								<span class="h-2 w-2 shrink-0 rounded-full bg-emerald-500"></span>
							</button>
						{/each}
					{/if}
				</Tabs.Content>
				<Tabs.Content value="manual" class="flex flex-col gap-1.5 pt-2">
					{#if drafts.length === 0}
						<p class="py-4 text-center text-sm text-muted-foreground">
							이 테마에 장치 애셋이 없습니다.
						</p>
					{/if}
					{#each drafts as draft (draft.deviceId)}
						<div class="flex items-center gap-2">
							<span class="w-32 shrink-0 truncate text-sm">{draft.label}</span>
							<Input
								bind:value={draft.code}
								class="flex-1 font-mono"
								disabled={busy}
								aria-label={`${draft.label} 테스트 코드`}
							/>
						</div>
					{/each}
					{#if validationError && tab === 'manual' && drafts.length > 0}
						<p class="text-sm text-destructive">{validationError}</p>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
			<Dialog.Footer>
				<Button variant="outline" disabled={busy} onclick={() => (open = false)}>취소</Button>
				<Button disabled={busy || validationError !== null} onclick={handleCreate}>
					{#if busy}<Spinner />{:else if tab === 'link'}<ExternalLinkIcon />{/if}
					{tab === 'link' ? 'Player 앱에서 열기' : '만들기'}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
