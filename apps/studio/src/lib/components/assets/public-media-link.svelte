<script lang="ts">
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

	/** Stable public URL of a file-backed asset (`/api/media/{assetId}`). */
	let { url }: { url: string } = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- served media URL, not app navigation -->
<a
	href={url}
	class="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
	target="_blank"
	rel="noreferrer"
>
	<ExternalLinkIcon class="size-3" />
	{url}
</a>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
