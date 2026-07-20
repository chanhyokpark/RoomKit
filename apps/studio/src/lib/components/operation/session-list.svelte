<script lang="ts">
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { ApiError } from '$lib/api/client';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { createSession, deleteSession } from '$lib/api/sessions';
	import { useOperationData, type SessionView } from './operation-data.svelte';
	import TestSessionDialog from './test-session-dialog.svelte';

	const data = useOperationData();

	let testDialogOpen = $state(false);
	let creatingProduction = $state(false);
	let deleteTarget = $state<SessionView | null>(null);
	let deleting = $state(false);

	const stateLabels: Record<SessionView['state'], string> = {
		created: '시작 전',
		running: '진행 중',
		paused: '일시정지',
		ended: '종료됨'
	};

	function stateBadgeVariant(state: SessionView['state']) {
		if (state === 'running') return 'outline' as const;
		if (state === 'ended') return 'destructive' as const;
		return 'secondary' as const;
	}

	// Creation is harmless (the session stays idle until started from the dashboard).
	async function createProduction(): Promise<void> {
		if (creatingProduction) return;
		creatingProduction = true;
		try {
			const session = await createSession({ themeId: data.themeId, mode: 'production' });
			await data.refreshSessions();
			data.select(session.id);
			toast.success('프로덕션 세션을 만들었습니다. 대시보드에서 시작하세요.');
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : '세션 생성에 실패했습니다.');
		} finally {
			creatingProduction = false;
		}
	}

	async function handleDelete(sessionId: string): Promise<void> {
		if (deleting) return;
		deleting = true;
		try {
			await deleteSession(sessionId);
			await data.forgetSession(sessionId);
			toast.success('세션을 삭제했습니다.');
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : '세션 삭제에 실패했습니다.');
		} finally {
			deleting = false;
		}
	}

	function startedAtLabel(session: SessionView): string {
		return session.startedAt.toLocaleString('ko-KR', {
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="flex flex-col gap-2">
	<Button
		size="sm"
		disabled={data.hasLiveProduction || creatingProduction}
		onclick={createProduction}
	>
		<PlusIcon data-icon="inline-start" />
		프로덕션 세션 만들기
	</Button>
	<Button size="sm" variant="outline" onclick={() => (testDialogOpen = true)}>
		<FlaskConicalIcon data-icon="inline-start" />
		테스트 세션 만들기
	</Button>

	<div class="mt-2 flex flex-col gap-1">
		{#if data.sessions.length === 0}
			<p class="py-6 text-center text-sm text-muted-foreground">세션이 없습니다.</p>
		{/if}
		{#each data.sessions as session (session.id)}
			<div
				class="group relative rounded-md border transition-colors hover:bg-accent {data.selectedSessionId ===
				session.id
					? 'border-primary bg-accent'
					: ''}"
			>
				<button
					type="button"
					class="flex w-full flex-col gap-1 p-2 text-left text-sm"
					onclick={() => data.select(session.id)}
				>
					<div class="flex items-center gap-1.5">
						<Badge variant={session.mode === 'production' ? 'default' : 'secondary'}>
							{session.mode === 'production' ? '프로덕션' : '테스트'}
						</Badge>
						<Badge variant={stateBadgeVariant(session.state)}>
							{stateLabels[session.state]}
						</Badge>
					</div>
					<span class="text-xs text-muted-foreground">
						{session.state === 'created' ? '생성' : '시작'}: {startedAtLabel(session)}
					</span>
				</button>
				{#if session.state === 'created' || session.state === 'ended'}
					<Button
						variant="ghost"
						size="icon"
						class="absolute top-1.5 right-1.5 size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
						aria-label="세션 삭제"
						onclick={() => (deleteTarget = session)}
					>
						<Trash2Icon class="size-3.5" />
					</Button>
				{/if}
			</div>
		{/each}
	</div>
</div>

<TestSessionDialog bind:open={testDialogOpen} />

<AlertDialog.Root
	open={deleteTarget !== null}
	onOpenChange={(value) => {
		if (!value) deleteTarget = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>세션을 삭제할까요?</AlertDialog.Title>
			<AlertDialog.Description>
				세션과 모든 로그가 영구히 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleting}>취소</AlertDialog.Cancel>
			<AlertDialog.Action
				disabled={deleting}
				onclick={() => {
					if (!deleteTarget) return;
					const id = deleteTarget.id;
					deleteTarget = null;
					void handleDelete(id);
				}}
			>
				삭제
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
