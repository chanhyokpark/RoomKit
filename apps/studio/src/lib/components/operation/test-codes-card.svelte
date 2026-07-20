<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import { toast } from 'svelte-sonner';
	import type { TestDeviceCode } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { getSession } from '$lib/api/sessions';
	import type { SessionView } from './operation-data.svelte';

	let { session }: { session: SessionView } = $props();

	let codes = $state<TestDeviceCode[] | null>(null);

	// The dashboard keys this card by session id, so a setup-time fetch suffices.
	// svelte-ignore state_referenced_locally
	getSession(session.id)
		.then((res) => (codes = res.testDeviceCodes ?? []))
		.catch(() => toast.error('테스트 코드를 불러오지 못했습니다.'));

	async function copyCode(code: string): Promise<void> {
		await navigator.clipboard.writeText(code);
		toast.success('코드가 복사되었습니다.');
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<KeyRoundIcon class="size-4" />
			테스트 코드
		</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-1.5">
		{#if codes === null}
			<Skeleton class="h-9 w-full" />
			<Skeleton class="h-9 w-full" />
		{:else if codes.length === 0}
			<p class="text-sm text-muted-foreground">발급된 코드가 없습니다.</p>
		{:else}
			{#each codes as entry (entry.deviceId)}
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
		{/if}
	</Card.Content>
</Card.Root>
