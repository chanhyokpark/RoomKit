<script lang="ts">
	import type { Asset, ComponentRef, ComponentSlot, MessageField } from '@roomkit/shared';
	import * as Field from '$lib/components/ui/field';
	import * as Select from '$lib/components/ui/select';
	import { listAssets } from '$lib/api/assets';
	import ComponentPropsFields from './component-props-fields.svelte';

	// Attaches a component asset (filtered to one slot) plus per-use props —
	// the reuse point: one component, different props per asset.
	let {
		themeId,
		// `slot` is reserved on Svelte components, hence the name.
		slotKind,
		label,
		description = '',
		value = $bindable()
	}: {
		themeId: string;
		slotKind: ComponentSlot;
		label: string;
		description?: string;
		value: ComponentRef | null;
	} = $props();

	const NONE = 'none';

	let components = $state<Asset[]>([]);

	$effect(() => {
		listAssets(themeId, { kind: 'component' }).then((result) => {
			components = result.filter(
				(asset) => asset.kind === 'component' && asset.data.slot === slotKind
			);
		});
	});

	const selected = $derived.by(() => {
		const current = value;
		if (current === null) return undefined;
		return components.find((asset) => asset.id === current.componentId);
	});
	const params = $derived<MessageField[]>(
		selected?.kind === 'component' ? selected.data.params : []
	);
	const fieldId = $derived(`component-ref-${slotKind}`);

	function onSelect(componentId: string): void {
		if (componentId === NONE) {
			value = null;
			return;
		}
		// Switching components keeps props only when re-selecting the same one.
		if (value?.componentId !== componentId) value = { componentId, props: {} };
	}
</script>

<Field.Field>
	<Field.FieldLabel for={fieldId}>{label}</Field.FieldLabel>
	<Select.Root type="single" value={value?.componentId ?? NONE} onValueChange={onSelect}>
		<Select.Trigger id={fieldId} class="w-full">
			{value === null ? '기본 스타일' : (selected?.name ?? '삭제된 컴포넌트')}
		</Select.Trigger>
		<Select.Content>
			<Select.Group>
				<Select.Item value={NONE} label="기본 스타일">기본 스타일</Select.Item>
				{#each components as component (component.id)}
					<Select.Item value={component.id} label={component.name}>{component.name}</Select.Item>
				{/each}
			</Select.Group>
		</Select.Content>
	</Select.Root>
	{#if description}
		<Field.FieldDescription>{description}</Field.FieldDescription>
	{/if}
	{#if value !== null && selected}
		<ComponentPropsFields fields={params} values={value.props} />
	{/if}
</Field.Field>
