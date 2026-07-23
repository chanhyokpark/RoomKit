<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import DramaIcon from '@lucide/svelte/icons/drama';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import { toast } from 'svelte-sonner';
	import type { Theme } from '@roomkit/shared';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { toastApiError } from '$lib/api/client';
	import { deleteTheme, downloadThemeExport, duplicateTheme, importTheme } from '$lib/api/themes';
	import { themesStore } from '$lib/stores/themes.svelte';
	import ThemeFormDialog from './theme-form-dialog.svelte';

	const currentTheme = $derived(themesStore.find(page.params.themeId));

	let formOpen = $state(false);
	let formTheme = $state<Theme | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state(false);
	let duplicating = $state(false);
	let exporting = $state(false);
	let importing = $state(false);
	let importInput = $state<HTMLInputElement | null>(null);

	function openCreate() {
		formTheme = null;
		formOpen = true;
	}

	function openRename() {
		formTheme = currentTheme ?? null;
		formOpen = true;
	}

	async function handleDuplicate() {
		if (!currentTheme || duplicating) return;
		duplicating = true;
		const toastId = toast.loading('테마를 복제하는 중…');
		try {
			const copy = await duplicateTheme(currentTheme.id);
			await themesStore.refresh();
			toast.success(`"${copy.name}" 테마를 만들었습니다.`, { id: toastId });
			await goto(resolve('/(app)/themes/[themeId]', { themeId: copy.id }));
		} catch (error) {
			toast.dismiss(toastId);
			toastApiError(error, '테마 복제에 실패했습니다.');
		} finally {
			duplicating = false;
		}
	}

	async function handleExport() {
		if (!currentTheme || exporting) return;
		exporting = true;
		const toastId = toast.loading('테마를 내보내는 중…');
		try {
			await downloadThemeExport(currentTheme.id);
			toast.success('테마를 내보냈습니다.', { id: toastId });
		} catch (error) {
			toast.dismiss(toastId);
			toastApiError(error, '테마 내보내기에 실패했습니다.');
		} finally {
			exporting = false;
		}
	}

	async function handleImportFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || importing) return;
		importing = true;
		const toastId = toast.loading('테마를 가져오는 중…');
		try {
			const theme = await importTheme(file, (percent) => {
				toast.loading(`테마를 가져오는 중… ${percent}%`, { id: toastId });
			});
			await themesStore.refresh();
			toast.success(`"${theme.name}" 테마를 가져왔습니다.`, { id: toastId });
			await goto(resolve('/(app)/themes/[themeId]', { themeId: theme.id }));
		} catch (error) {
			toast.dismiss(toastId);
			toastApiError(error, '테마 가져오기에 실패했습니다.');
		} finally {
			importing = false;
		}
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
		} catch (error) {
			toastApiError(error, '테마 삭제에 실패했습니다.');
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
					<DropdownMenu.Item disabled={!currentTheme || duplicating} onSelect={handleDuplicate}>
						<CopyIcon />
						테마 복제
					</DropdownMenu.Item>
					<DropdownMenu.Item disabled={!currentTheme || exporting} onSelect={handleExport}>
						<DownloadIcon />
						테마 내보내기
					</DropdownMenu.Item>
					<DropdownMenu.Item disabled={importing} onSelect={() => importInput?.click()}>
						<UploadIcon />
						테마 가져오기
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

<input
	type="file"
	accept=".zip,application/zip"
	class="hidden"
	bind:this={importInput}
	onchange={handleImportFile}
/>

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
