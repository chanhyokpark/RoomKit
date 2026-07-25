<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import SquareIcon from '@lucide/svelte/icons/square';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { normalizeUrl, useWebsiteTestData } from './website-test-data.svelte';

	const data = useWebsiteTestData();
	const run = $derived(data.run!);

	// Writable derived: edits stick until the run's URL actually changes.
	let urlDraft = $derived(run.url);
	const urlChanged = $derived(normalizeUrl(urlDraft) !== run.url && normalizeUrl(urlDraft) !== '');

	let busy = $state(false);

	async function guard(action: () => Promise<void>): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await action();
		} finally {
			busy = false;
		}
	}

	const selectedPhaseName = $derived(
		run.phaseId === null ? null : (data.assetName(run.phaseId) ?? '삭제된 페이즈')
	);

	async function copyCode(): Promise<void> {
		try {
			await navigator.clipboard.writeText(run.code);
			toast.success('접속 코드를 복사했습니다.');
		} catch {
			toast.error('클립보드 복사에 실패했습니다.');
		}
	}
</script>

<Card.Root>
	<Card.Content class="flex flex-col gap-3">
		<div class="flex flex-wrap items-center gap-2">
			<FlaskConicalIcon class="size-4" />
			<span class="font-medium">{run.displayName || run.deviceName}</span>
			{#if run.deviceOnline}
				<Badge>온라인</Badge>
			{:else}
				<Badge variant="secondary">연결 대기 중…</Badge>
			{/if}
			<button
				type="button"
				class="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
				title="장치 접속 코드 복사"
				onclick={copyCode}
			>
				{run.code}
				<CopyIcon class="size-3" />
			</button>
			<div class="ml-auto flex items-center gap-2">
				<Select.Root
					type="single"
					value={run.phaseId ?? ''}
					onValueChange={(value) => guard(() => data.setPhase(value === '' ? null : value))}
				>
					<Select.Trigger size="sm" aria-label="시뮬레이션 페이즈">
						<span class="text-xs">
							페이즈: {selectedPhaseName ?? '없음'}
						</span>
					</Select.Trigger>
					<Select.Content>
						<Select.Group>
							<Select.Item value="" label="없음">없음</Select.Item>
							{#each data.phases as phase (phase.id)}
								<Select.Item value={phase.id} label={phase.name}>{phase.name}</Select.Item>
							{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
				<Button
					size="sm"
					variant="destructive"
					disabled={busy}
					onclick={() => guard(() => data.stop())}
				>
					<SquareIcon data-icon="inline-start" />
					종료
				</Button>
			</div>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<Input
				class="h-8 min-w-56 flex-1 font-mono text-xs"
				bind:value={urlDraft}
				aria-label="웹사이트 URL"
				onkeydown={(keyEvent) => {
					if (keyEvent.key === 'Enter' && urlChanged) {
						void guard(() => data.setUrl(normalizeUrl(urlDraft)));
					}
				}}
			/>
			{#if urlChanged}
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onclick={() => guard(() => data.setUrl(normalizeUrl(urlDraft)))}
				>
					이동
				</Button>
			{/if}
			<Button
				size="sm"
				variant="outline"
				disabled={busy}
				onclick={() => guard(() => data.reload())}
			>
				<RotateCwIcon data-icon="inline-start" />
				사이트 새로고침
			</Button>
		</div>
		<p class="text-xs text-muted-foreground">
			시뮬레이션 페이즈는 트리거 매칭 표시에만 사용됩니다. 웹사이트가 발생시킨 트리거는 실행되지
			않고 활동 로그에 표시됩니다. 서버 재시작 시 테스트는 초기화됩니다.
		</p>
	</Card.Content>
</Card.Root>
