<script lang="ts">
	import { untrack } from 'svelte';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { toast } from 'svelte-sonner';
	import { ApiError } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Spinner } from '$lib/components/ui/spinner';
	import { createSession } from '$lib/api/sessions';
	import { useOperationData } from './operation-data.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const data = useOperationData();

	interface CodeDraft {
		deviceId: string;
		label: string;
		code: string;
	}

	let drafts = $state<CodeDraft[]>([]);
	let busy = $state(false);
	let createdId = $state<string | null>(null);

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
		if (trimmed.some((d) => d.code === '')) return '모든 장치에 코드를 입력하세요.';
		if (new Set(trimmed.map((d) => d.code)).size !== trimmed.length) return '코드가 중복됩니다.';
		return null;
	});

	// bits-ui only fires onOpenChange for internally-triggered changes, and this
	// dialog is opened by external state assignment — initialize on open here.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			createdId = null;
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
			const session = await createSession({
				themeId: data.themeId,
				mode: 'test',
				deviceCodes: trimmed.map((d) => ({ deviceId: d.deviceId, code: d.code }))
			});
			createdId = session.id;
			saveCodes(trimmed);
			await data.refreshSessions();
			data.select(session.id);
			toast.success('테스트 세션을 만들었습니다.');
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : '테스트 세션 생성에 실패했습니다.');
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
				장치별 테스트 코드를 입력하세요. 테스터는 이 코드로 접속합니다.
			</Dialog.Description>
		</Dialog.Header>
		{#if createdId}
			<div class="flex flex-col gap-1.5">
				{#each trimmed as entry (entry.deviceId)}
					<div class="flex items-center gap-2 rounded-md border p-2">
						<span class="flex-1 truncate text-sm">{entry.label}</span>
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
			<div class="flex flex-col gap-1.5">
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
				{#if validationError && drafts.length > 0}
					<p class="text-sm text-destructive">{validationError}</p>
				{/if}
			</div>
			<Dialog.Footer>
				<Button variant="outline" disabled={busy} onclick={() => (open = false)}>취소</Button>
				<Button
					disabled={busy || (drafts.length > 0 && validationError !== null)}
					onclick={handleCreate}
				>
					{#if busy}<Spinner />{/if}
					만들기
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
