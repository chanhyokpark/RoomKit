<script lang="ts">
	import ListIcon from '@lucide/svelte/icons/list';
	import PlayIcon from '@lucide/svelte/icons/play';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import type { WebsiteTestActivity } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { useWebsiteTestData } from './website-test-data.svelte';

	const data = useWebsiteTestData();

	const entries = $derived(data.activity.toReversed());

	function time(at: number): string {
		return new Date(at).toLocaleTimeString('ko-KR', { hour12: false });
	}

	function statusVariant(entry: WebsiteTestActivity): 'default' | 'secondary' | 'destructive' {
		if (entry.level === 'error') return 'destructive';
		if (entry.level === 'warn') return 'secondary';
		return 'default';
	}

	function payloadPreview(payload: unknown): string | null {
		if (payload === undefined) return null;
		try {
			const text = JSON.stringify(payload);
			return text.length > 120 ? `${text.slice(0, 120)}…` : text;
		} catch {
			return null;
		}
	}
</script>

<Card.Root class="min-h-0">
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<ListIcon class="size-4" />
			활동 로그
		</Card.Title>
	</Card.Header>
	<Card.Content>
		{#if entries.length === 0}
			<p class="text-sm text-muted-foreground">
				아직 활동이 없습니다. 웹사이트에서 트리거를 발생시키거나 커맨드를 실행해 보세요.
			</p>
		{:else}
			<ul class="flex max-h-[32rem] flex-col gap-1 overflow-y-auto text-sm">
				{#each entries as entry (entry.id)}
					<li
						class="rounded-md px-2 py-1.5 {entry.level === 'error'
							? 'bg-destructive/10'
							: entry.level === 'warn'
								? 'bg-amber-500/10'
								: ''}"
					>
						<div class="flex items-baseline gap-2">
							<span class="shrink-0 font-mono text-[10px] text-muted-foreground">
								{time(entry.at)}
							</span>
							{#if entry.kind === 'trigger'}
								<ZapIcon class="size-3.5 shrink-0 translate-y-0.5 text-amber-500" />
							{/if}
							<span
								class="min-w-0 flex-1 break-words {entry.kind === 'command' &&
								(entry.status === 'skipped' || entry.status === 'blocked')
									? 'text-muted-foreground'
									: ''}"
							>
								{entry.message}
							</span>
							{#if entry.kind === 'command'}
								<Badge variant={statusVariant(entry)} class="shrink-0 text-[10px]">
									{entry.status}
								</Badge>
							{/if}
						</div>
						{#if entry.kind === 'trigger'}
							{@const preview = payloadPreview(entry.payload)}
							{#if preview}
								<p class="mt-0.5 pl-14 font-mono text-xs break-all text-muted-foreground">
									{preview}
								</p>
							{/if}
							{#if entry.matches.length === 0}
								<p class="mt-0.5 pl-14 text-xs text-muted-foreground">일치하는 이벤트 없음</p>
							{:else}
								<ul class="mt-1 flex flex-col gap-1 pl-14">
									{#each entry.matches as match (match.eventId)}
										<li class="flex items-center gap-2 text-xs">
											<span class="min-w-0 truncate">{match.eventName}</span>
											{#if !match.inSimulatedPhase}
												<Badge variant="secondary" class="shrink-0 text-[10px]">다른 페이즈</Badge>
											{/if}
											<Button
												class="h-6 shrink-0 px-2 text-xs"
												size="sm"
												variant="outline"
												disabled={data.runningEvent !== null}
												onclick={() => data.runEvent(match.eventId)}
											>
												<PlayIcon class="size-3" data-icon="inline-start" />
												이 이벤트 실행
											</Button>
										</li>
									{/each}
								</ul>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Card.Content>
</Card.Root>
