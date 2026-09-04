import {
  RoomKitClient,
  type ConnectionStatus,
  type DoneFn,
  type PlaybackProgress,
  type SessionState,
  type WireBgmVolume,
  type WireNavigate,
  type WirePlayCommand,
  type WirePlayDialogue,
  type WireStop,
} from '@roomkit/client';

type PlayBgm = Extract<WirePlayCommand, { channel: 'bgm' }>;
type PlaySfx = Extract<WirePlayCommand, { channel: 'sfx' }>;
type PlayVideo = Extract<WirePlayCommand, { channel: 'video' }>;

export interface DeviceConfig {
  serverUrl: string;
  deviceCode: string;
  deviceName: string;
}

export interface SubtitleState {
  html: string;
  css: string;
  lineIndex: number;
  lineCount: number;
}

export interface VideoState {
  command: PlayVideo;
}

export interface WebsiteState {
  command: WireNavigate;
  key: number;
}

export interface DeviceCallbacks {
  onStatus: (status: ConnectionStatus, detail?: string) => void;
  onSession: (session: SessionState) => void;
  onSubtitle: (subtitle: SubtitleState | null) => void;
  onVideo: (video: VideoState | null) => void;
  onWebsite: (website: WebsiteState | null) => void;
  onHintCode: (value: { code: string; css: string } | null) => void;
  onLog: (message: string) => void;
}

interface ActiveAudio {
  commandId: string;
  playerId: string;
  done: DoneFn;
  audio: HTMLAudioElement | null;
  timer: number | null;
  fadeOutMs: number;
  finish: (status?: 'done' | 'failed') => void;
}

const DUCK_ATTACK_MS = 250;
const DUCK_RELEASE_MS = 1000;

interface DialogueRun {
  command: WirePlayDialogue;
  done: DoneFn;
  cancelled: boolean;
  audio: HTMLAudioElement | null;
  timer: number | null;
  release: (() => void) | null;
}

interface ActiveVideo {
  command: PlayVideo;
  done: DoneFn;
  timer: number | null;
}

export class RoomKitDevice {
  readonly client: RoomKitClient;
  private readonly bgm = new Map<string, ActiveAudio>();
  private readonly sfx = new Map<string, ActiveAudio>();
  private readonly dialogues = new Map<string, DialogueRun>();
  private readonly screenDialogues = new Map<string, WirePlayDialogue>();
  private readonly resumeWaiters = new Map<string, () => void>();
  private readonly ducking = new Map<string, Map<string, number>>();
  private readonly bgmVolumes = new Map<string, number>();
  private activeVideo: ActiveVideo | null = null;
  private pendingNavigation: { commandId: string; done: DoneFn } | null = null;

  constructor(
    config: DeviceConfig,
    private readonly callbacks: DeviceCallbacks,
  ) {
    this.client = new RoomKitClient({
      serverUrl: config.serverUrl,
      deviceCode: config.deviceCode,
      deviceName: config.deviceName,
      retryOnFatalError: true,
      persistTestCode: false,
      debug: import.meta.env.DEV,
    });

    this.client.on('status', callbacks.onStatus);
    this.client.on('sessionState', callbacks.onSession);
    this.client.on('play', (command, done) => this.play(command, done));
    this.client.on('stop', (command) => this.stop(command));
    this.client.on('bgmVolume', (command) => this.setBgmVolume(command));
    this.client.on('progress', (progress) => this.progress(progress));
    this.client.on('navigate', (_url, command, done) =>
      this.navigate(command, done),
    );
    this.client.on('message', async (payload, command) => {
      callbacks.onLog(
        `메시지 ${command.messageName}: ${JSON.stringify(payload)}`,
      );
      await Promise.resolve();
    });
    this.client.on('hintCode', (command) => {
      callbacks.onHintCode(
        command.code ? { code: command.code, css: command.css } : null,
      );
    });
    this.client.on('reset', () => this.reset());
    this.client.connect();
  }

  destroy() {
    this.stopEverything();
    this.pendingNavigation?.done('failed');
    this.pendingNavigation = null;
    this.client.disconnect();
  }

  trigger(event: string) {
    this.client.trigger(event, {
      source: 'web-custom-template',
      at: Date.now(),
    });
    this.callbacks.onLog(`트리거 전송: ${event}`);
  }

  navigationLoaded(commandId: string) {
    if (this.pendingNavigation?.commandId !== commandId) return;
    this.pendingNavigation.done();
    this.pendingNavigation = null;
    this.callbacks.onLog('웹사이트 로드 완료');
  }

  finishVideo(commandId: string, failed = false) {
    const active = this.activeVideo;
    if (!active || active.command.id !== commandId) return;
    if (active.timer !== null) window.clearTimeout(active.timer);
    active.done(failed ? 'failed' : 'done');
    this.activeVideo = null;
    this.callbacks.onVideo(null);
    this.callbacks.onLog(failed ? '비디오 실패 응답' : '비디오 완료 응답');
  }

  private play(command: WirePlayCommand, done: DoneFn) {
    this.callbacks.onLog(`재생: ${command.channel} / ${command.assetName}`);
    switch (command.channel) {
      case 'bgm':
        this.playBgm(command, done);
        break;
      case 'sfx':
        this.playSfx(command, done);
        break;
      case 'dialogue':
        this.playDialogue(command, done);
        break;
      case 'video':
        this.playVideo(command, done);
        break;
    }
  }

  private playBgm(command: PlayBgm, done: DoneFn) {
    const previous = this.bgm.get(command.playerId);
    if (previous) this.fadeAndFinish(previous);

    const active = this.createAudio(command, done, command.fadeOutMs, () => {
      if (this.bgm.get(command.playerId) === active)
        this.bgm.delete(command.playerId);
    });
    this.bgm.set(command.playerId, active);

    if (!command.url) {
      if (command.loop) done();
      else
        active.timer = window.setTimeout(
          () => active.finish(),
          command.durationMs ?? 1,
        );
      return;
    }

    active.audio = new Audio(command.url);
    active.audio.loop = command.loop;
    active.audio.volume =
      command.fadeInMs > 0 ? 0 : this.bgmTargetVolume(command.playerId);
    active.audio.onended = () => active.finish();
    active.audio.onerror = () => active.finish('failed');
    void active.audio
      .play()
      .then(() => {
        this.fadeVolume(
          active.audio!,
          active.audio!.volume,
          this.bgmTargetVolume(command.playerId),
          command.fadeInMs,
        );
        if (command.loop) done();
      })
      .catch(() => active.finish('failed'));
  }

  private playSfx(command: PlaySfx, done: DoneFn) {
    const active = this.createAudio(command, done, 0, () => {
      this.sfx.delete(command.id);
      this.removeDuck(command.playerId, command.id);
    });
    this.sfx.set(command.id, active);
    if (command.bgmDuck !== undefined)
      this.addDuck(command.playerId, command.id, command.bgmDuck);

    if (!command.url) {
      active.timer = window.setTimeout(
        () => active.finish(),
        command.durationMs ?? 1,
      );
      return;
    }
    active.audio = new Audio(command.url);
    active.audio.onended = () => active.finish();
    active.audio.onerror = () => active.finish('failed');
    void active.audio.play().catch(() => active.finish('failed'));
  }

  private createAudio(
    command: { id: string; playerId: string },
    done: DoneFn,
    fadeOutMs: number,
    cleanup: () => void,
  ): ActiveAudio {
    let finished = false;
    const active: ActiveAudio = {
      commandId: command.id,
      playerId: command.playerId,
      done,
      audio: null,
      timer: null,
      fadeOutMs,
      finish: (status = 'done') => {
        if (finished) return;
        finished = true;
        if (active.timer !== null) window.clearTimeout(active.timer);
        if (active.audio) {
          active.audio.onended = null;
          active.audio.onerror = null;
          active.audio.pause();
        }
        cleanup();
        done(status);
      },
    };
    return active;
  }

  private playDialogue(command: WirePlayDialogue, done: DoneFn) {
    this.stopDialogueForPlayer(command.playerId);
    if (command.role === 'screen') {
      this.screenDialogues.set(command.id, command);
      done();
      return;
    }

    const run: DialogueRun = {
      command,
      done,
      cancelled: false,
      audio: null,
      timer: null,
      release: null,
    };
    this.dialogues.set(command.playerId, run);
    if (command.role === 'both') this.screenDialogues.set(command.id, command);
    if (command.bgmDuck !== undefined)
      this.addDuck(command.playerId, command.id, command.bgmDuck);
    void this.runDialogue(run);
  }

  private async runDialogue(run: DialogueRun) {
    let failed = false;
    const { command } = run;

    for (
      let index = 0;
      index < command.lines.length && !run.cancelled;
      index += 1
    ) {
      const line = command.lines[index];
      if (line.holdBefore) {
        this.client.sendProgress(command.id, index, true);
        await new Promise<void>((resolve) => {
          run.release = resolve;
          this.resumeWaiters.set(`${command.id}:${index}`, resolve);
        });
        run.release = null;
        this.resumeWaiters.delete(`${command.id}:${index}`);
        if (run.cancelled) break;
      }

      this.client.sendProgress(command.id, index);
      if (command.role === 'both') this.showDialogueLine(command, index);
      failed = !(await this.playDialogueLine(run, line.url, line.durationMs));
      if (failed) break;
    }

    if (this.dialogues.get(command.playerId) === run)
      this.dialogues.delete(command.playerId);
    this.screenDialogues.delete(command.id);
    this.removeDuck(command.playerId, command.id);
    if (!command.keepSubtitleAfterEnd || run.cancelled)
      this.callbacks.onSubtitle(null);
    run.done(failed ? 'failed' : 'done');
  }

  private playDialogueLine(
    run: DialogueRun,
    url: string | null,
    durationMs: number | null,
  ) {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        run.release = null;
        run.timer = null;
        if (run.audio) {
          run.audio.onended = null;
          run.audio.onerror = null;
          run.audio.pause();
          run.audio = null;
        }
        resolve(ok);
      };
      run.release = () => finish(true);

      if (!url) {
        run.timer = window.setTimeout(() => finish(true), durationMs ?? 1);
        return;
      }
      const audio = new Audio(url);
      run.audio = audio;
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      void audio.play().catch(() => finish(false));
    });
  }

  private progress(progress: PlaybackProgress) {
    const resume = this.resumeWaiters.get(
      `${progress.commandId}:${progress.lineIndex}`,
    );
    if (resume && !progress.waiting) resume();

    const dialogue = this.screenDialogues.get(progress.commandId);
    if (dialogue && !progress.waiting)
      this.showDialogueLine(dialogue, progress.lineIndex);
  }

  private showDialogueLine(command: WirePlayDialogue, index: number) {
    const line = command.lines[index];
    if (!line) return;
    this.callbacks.onSubtitle({
      html: line.subtitleHtml,
      css: command.subtitleCss,
      lineIndex: index,
      lineCount: command.lines.length,
    });
  }

  private playVideo(command: PlayVideo, done: DoneFn) {
    if (this.activeVideo) this.finishVideo(this.activeVideo.command.id);
    this.activeVideo = { command, done, timer: null };
    this.callbacks.onVideo({ command });
    if (!command.url) {
      this.activeVideo.timer = window.setTimeout(
        () => this.finishVideo(command.id),
        command.durationMs ?? 1,
      );
    }
  }

  private stop(command: WireStop) {
    const matches = (playerId: string) =>
      command.playerId === null || command.playerId === playerId;
    if (command.channel === 'bgm') {
      for (const active of this.bgm.values())
        if (matches(active.playerId)) this.fadeAndFinish(active);
    }
    if (command.channel === 'sfx') {
      for (const active of this.sfx.values())
        if (matches(active.playerId)) active.finish();
    }
    if (command.channel === 'dialogue') {
      for (const playerId of [...this.dialogues.keys()])
        if (matches(playerId)) this.stopDialogueForPlayer(playerId);
      for (const [id, dialogue] of this.screenDialogues) {
        if (matches(dialogue.playerId)) this.screenDialogues.delete(id);
      }
      this.callbacks.onSubtitle(null);
    }
    if (
      command.channel === 'video' &&
      this.activeVideo &&
      matches(this.activeVideo.command.playerId)
    ) {
      this.finishVideo(this.activeVideo.command.id);
    }
    this.callbacks.onLog(`정지: ${command.channel}`);
  }

  private stopDialogueForPlayer(playerId: string) {
    const run = this.dialogues.get(playerId);
    if (!run) return;
    run.cancelled = true;
    if (run.timer !== null) window.clearTimeout(run.timer);
    run.audio?.pause();
    run.release?.();
    this.resumeWaiters.forEach((resume, key) => {
      if (key.startsWith(`${run.command.id}:`)) resume();
    });
  }

  private navigate(command: WireNavigate, done: DoneFn) {
    this.pendingNavigation?.done('failed');
    this.pendingNavigation = { commandId: command.id, done };
    this.callbacks.onWebsite({ command, key: command.force ? Date.now() : 0 });
    this.callbacks.onLog(`웹사이트 이동: ${command.url}`);
  }

  private reset() {
    this.stopEverything();
    this.pendingNavigation?.done('failed');
    this.pendingNavigation = null;
    this.callbacks.onWebsite(null);
    this.callbacks.onHintCode(null);
    this.callbacks.onLog('장치를 초기화했습니다.');
  }

  private stopEverything() {
    for (const active of [...this.bgm.values(), ...this.sfx.values()])
      active.finish();
    for (const playerId of [...this.dialogues.keys()])
      this.stopDialogueForPlayer(playerId);
    if (this.activeVideo) this.finishVideo(this.activeVideo.command.id);
    this.screenDialogues.clear();
    this.bgmVolumes.clear();
    this.callbacks.onSubtitle(null);
  }

  private setBgmVolume(command: WireBgmVolume) {
    if (command.value >= 1) this.bgmVolumes.delete(command.playerId);
    else this.bgmVolumes.set(command.playerId, command.value);
    const audio = this.bgm.get(command.playerId)?.audio;
    if (!audio) return;
    // durationMs > 0 ramps from the current audible volume to the new target.
    this.fadeVolume(
      audio,
      audio.volume,
      this.bgmTargetVolume(command.playerId),
      command.durationMs,
    );
  }

  private addDuck(playerId: string, commandId: string, factor: number) {
    const factors = this.ducking.get(playerId) ?? new Map<string, number>();
    factors.set(commandId, factor);
    this.ducking.set(playerId, factors);
    this.applyDuck(playerId);
  }

  private removeDuck(playerId: string, commandId: string) {
    const factors = this.ducking.get(playerId);
    factors?.delete(commandId);
    if (factors?.size === 0) this.ducking.delete(playerId);
    this.applyDuck(playerId);
  }

  private duckVolume(playerId: string) {
    const values = [...(this.ducking.get(playerId)?.values() ?? [])];
    return values.length ? Math.min(...values) : 1;
  }

  private bgmTargetVolume(playerId: string) {
    return (this.bgmVolumes.get(playerId) ?? 1) * this.duckVolume(playerId);
  }

  private applyDuck(playerId: string) {
    const audio = this.bgm.get(playerId)?.audio;
    if (!audio) return;
    const target = this.bgmTargetVolume(playerId);
    // Duck quickly (attack) so dialogue/SFX is heard at once; release slowly.
    const rampMs = target < audio.volume ? DUCK_ATTACK_MS : DUCK_RELEASE_MS;
    this.fadeVolume(audio, audio.volume, target, rampMs);
  }

  private fadeAndFinish(active: ActiveAudio) {
    if (!active.audio || active.fadeOutMs === 0) {
      active.finish();
      return;
    }
    this.fadeVolume(
      active.audio,
      active.audio.volume,
      0,
      active.fadeOutMs,
      () => active.finish(),
    );
  }

  private fadeVolume(
    audio: HTMLAudioElement,
    from: number,
    to: number,
    durationMs: number,
    complete?: () => void,
  ) {
    if (durationMs <= 0) {
      audio.volume = to;
      complete?.();
      return;
    }
    const startedAt = performance.now();
    const step = (now: number) => {
      if (audio.paused && to !== 0) return;
      const progress = Math.min(1, (now - startedAt) / durationMs);
      audio.volume = from + (to - from) * progress;
      if (progress < 1) requestAnimationFrame(step);
      else complete?.();
    };
    requestAnimationFrame(step);
  }
}
