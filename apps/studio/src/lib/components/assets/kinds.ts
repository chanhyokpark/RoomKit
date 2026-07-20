import type { Icon as IconType } from '@lucide/svelte';
import CpuIcon from '@lucide/svelte/icons/cpu';
import FilmIcon from '@lucide/svelte/icons/film';
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

export const ASSET_KINDS: AssetKind[] = AssetKindSchema.options;

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
	hint: { label: '힌트', icon: LightbulbIcon, layout: 'table' },
	player: { label: '플레이어', icon: SpeakerIcon, layout: 'grid' },
	website: { label: '웹사이트', icon: GlobeIcon, layout: 'table' },
	message: { label: '메시지', icon: MailIcon, layout: 'table' },
	phase: { label: '페이즈', icon: MilestoneIcon, layout: 'table' },
	event: { label: '이벤트', icon: ZapIcon, layout: 'table' }
};
