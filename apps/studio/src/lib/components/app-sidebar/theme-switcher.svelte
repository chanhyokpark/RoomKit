<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import DramaIcon from '@lucide/svelte/icons/drama';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import type { Theme } from '@roomkit/shared';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { deleteTheme } from '$lib/api/themes';
	import { themesStore } from '$lib/stores/themes.svelte';
	import ThemeFormDialog from './theme-form-dialog.svelte';

	const currentTheme = $derived(themesStore.find(page.params.themeId));

	let formOpen = $state(false);
	let formTheme = $state<Theme | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state(false);

	function openCreate() {
		formTheme = null;
		formOpen = true;
	}

	function openRename() {
		formTheme = currentTheme ?? null;
		formOpen = true;
	}

	async function handleDelete() {
		if (!currentTheme || deleting) return;
		deleting = true;
		try {
			await deleteTheme(currentTheme.id);
			await themesStore.refresh();
			toast.success('테마를 삭제했습니다.');
			deleteOpen = false;
			await goto(resolve('/'));
		} catch {
			toast.error('테마 삭제에 실패했습니다.');
		} finally {
			deleting = false;
		}
	}
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						{...props}
						size="lg"
						class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
					>
						<div
							class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
						>
							<DramaIcon class="size-4" />
						</div>
						<div class="grid flex-1 text-start text-sm leading-tight">
							<span class="truncate font-medium">{currentTheme?.name ?? '테마 선택'}</span>
							<span class="truncate text-xs text-muted-foreground">
								{currentTheme?.timeLimitMs
									? `제한 시간 ${Math.round(currentTheme.timeLimitMs / 60_000)}분`
									: '타이머 없음'}
							</span>
						</div>
						<ChevronsUpDownIcon class="ml-auto" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content class="w-(--bits-dropdown-menu-anchor-width) min-w-56" align="start">
				<DropdownMenu.Group>
					<DropdownMenu.GroupHeading>테마</DropdownMenu.GroupHeading>
					{#each themesStore.themes as theme (theme.id)}
						<DropdownMenu.Item
							onSelect={() => goto(resolve('/(app)/themes/[themeId]', { themeId: theme.id }))}
						>
							<span class="truncate">{theme.name}</span>
							{#if theme.id === currentTheme?.id}
								<CheckIcon class="ml-auto" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Group>
				<DropdownMenu.Separator />
				<DropdownMenu.Group>
					<DropdownMenu.Item onSelect={openCreate}>
						<PlusIcon />
						새 테마
					</DropdownMenu.Item>
					<DropdownMenu.Item disabled={!currentTheme} onSelect={openRename}>
						<PencilIcon />
						테마 수정
					</DropdownMenu.Item>
					<DropdownMenu.Item
						variant="destructive"
						disabled={!currentTheme}
						onSelect={() => (deleteOpen = true)}
					>
						<Trash2Icon />
						테마 삭제
					</DropdownMenu.Item>
				</DropdownMenu.Group>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>

<ThemeFormDialog
	bind:open={formOpen}
	theme={formTheme}
	onSaved={(saved) => goto(resolve('/(app)/themes/[themeId]', { themeId: saved.id }))}
/>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>테마를 삭제할까요?</AlertDialog.Title>
			<AlertDialog.Description>
				"{currentTheme?.name}" 테마와 이 테마의 모든 애셋이 함께 삭제됩니다. 이 작업은 되돌릴 수
				없습니다.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleting}>취소</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" disabled={deleting} onclick={handleDelete}>
				삭제
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
