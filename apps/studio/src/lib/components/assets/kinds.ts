import type { Icon as IconType } from '@lucide/svelte';
import CodeXmlIcon from '@lucide/svelte/icons/code-xml';
import CpuIcon from '@lucide/svelte/icons/cpu';
import FileIcon from '@lucide/svelte/icons/file';
import FilmIcon from '@lucide/svelte/icons/film';
import ImageIcon from '@lucide/svelte/icons/image';
import GlobeIcon from '@lucide/svelte/icons/globe';
import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
import MailIcon from '@lucide/svelte/icons/mail';
import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
import MilestoneIcon from '@lucide/svelte/icons/milestone';
import MusicIcon from '@lucide/svelte/icons/music';
import SpeakerIcon from '@lucide/svelte/icons/speaker';
import Volume2Icon from '@lucide/svelte/icons/volume-2';
import ZapIcon from '@lucide/svelte/icons/zap';
import { AssetKindSchema, type AssetKind } from '@roomkit/shared';

export interface AssetKindGroup {
	label: string;
	kinds: AssetKind[];
}

/** Tab order in the asset manager: hardware/output → media → device content → game flow. */
export const ASSET_KIND_GROUPS: AssetKindGroup[] = [
	{ label: '장치', kinds: ['device', 'player'] },
	{ label: '미디어', kinds: ['bgm', 'sfx', 'dialogue', 'video', 'image', 'file'] },
	{ label: '콘텐츠', kinds: ['website', 'message', 'hint', 'component'] },
	{ label: '진행', kinds: ['phase', 'event'] }
];

export const ASSET_KINDS: AssetKind[] = ASSET_KIND_GROUPS.flatMap((group) => group.kinds);

// Every schema kind must appear in exactly one group.
if (import.meta.env.DEV) {
	const missing = AssetKindSchema.options.filter((kind) => !ASSET_KINDS.includes(kind));
	if (missing.length > 0)
		throw new Error(`ASSET_KIND_GROUPS is missing kinds: ${missing.join(', ')}`);
}

interface KindMeta {
	label: string;
	icon: typeof IconType;
	/** How the asset list is rendered for this kind. */
	layout: 'grid' | 'table';
}

export const KIND_META: Record<AssetKind, KindMeta> = {
	device: { label: '장치', icon: CpuIcon, layout: 'grid' },
	bgm: { label: 'BGM', icon: MusicIcon, layout: 'grid' },
	dialogue: { label: '대사', icon: MessagesSquareIcon, layout: 'table' },
	sfx: { label: '효과음', icon: Volume2Icon, layout: 'grid' },
	video: { label: '비디오', icon: FilmIcon, layout: 'grid' },
	image: { label: '이미지', icon: ImageIcon, layout: 'grid' },
	file: { label: '파일', icon: FileIcon, layout: 'grid' },
	hint: { label: '힌트', icon: LightbulbIcon, layout: 'table' },
	player: { label: '플레이어', icon: SpeakerIcon, layout: 'grid' },
	website: { label: '웹사이트', icon: GlobeIcon, layout: 'table' },
	message: { label: '메시지', icon: MailIcon, layout: 'table' },
	component: { label: '컴포넌트', icon: CodeXmlIcon, layout: 'table' },
	phase: { label: '페이즈', icon: MilestoneIcon, layout: 'table' },
	event: { label: '이벤트', icon: ZapIcon, layout: 'table' }
};
