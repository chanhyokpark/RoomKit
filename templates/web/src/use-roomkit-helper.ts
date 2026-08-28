import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RoomKitHelper,
  type PlayerSubtitle,
  type PlayerVideoPlay,
} from '@roomkit/helper';

export type Subtitle = PlayerSubtitle['subtitle'];
export type DelegatedVideo = Omit<PlayerVideoPlay, 'source' | 'type'>;

export interface Activity {
  id: number;
  text: string;
}

export function useRoomKitHelper() {
  const helperRef = useRef<RoomKitHelper | null>(null);
  const placeholderTimerRef = useRef<number | null>(null);
  const [subtitle, setSubtitle] = useState<Subtitle>(null);
  const [video, setVideo] = useState<DelegatedVideo | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  const addActivity = useCallback((text: string) => {
    setActivities((items) => [{ id: Date.now() + Math.random(), text }, ...items].slice(0, 8));
  }, []);

  useEffect(() => {
    // 이 사이트가 자막과 비디오를 맡는다고 Player에 선언합니다.
    // 선언한 슬롯은 Player가 그리지 않으므로 아래 핸들러가 반드시 렌더링해야 합니다.
    // messages/testCallbacks에 등록한 이름은 Player에 보고되어 디버그 창에서
    // 목록으로 보이고, 테스트 세션에서 직접 실행해 볼 수 있습니다.
    const helper = new RoomKitHelper({
      lockdown: import.meta.env.PROD,
      renders: { subtitle: true, video: true, hintCode: false },
      messages: {
        // 메시지 애셋 이름별 핸들러. waitUntilEnd 메시지는 반환한 Promise가
        // 끝난 뒤 ack됩니다.
        announce: async (payload, envelope) => {
          addActivity(`메시지 ${envelope.messageName}: ${JSON.stringify(payload)}`);
          await Promise.resolve();
        },
      },
      testCallbacks: {
        // 디버그 창에서 인자 없이 실행할 수 있는 테스트 콜백입니다.
        'clear-activities': () => setActivities([]),
      },
    });
    helperRef.current = helper;

    const clearPlaceholder = () => {
      if (placeholderTimerRef.current !== null) window.clearTimeout(placeholderTimerRef.current);
      placeholderTimerRef.current = null;
    };

    helper.on('subtitle', (next) => {
      // null은 대사가 끝났거나 정지되었으니 자막을 지우라는 뜻입니다.
      setSubtitle(next);
      addActivity(next ? `자막 ${next.lineIndex + 1}/${next.lineCount}` : '자막 지우기');
    });

    helper.on('videoPlay', (next) => {
      clearPlaceholder();
      setVideo(next);
      addActivity(`비디오 재생: ${next.assetName}`);

      if (!next.url && next.durationMs) {
        // 파일 없는 플레이스홀더의 완료 타이머와 ack는 Player가 담당합니다.
        // 사이트는 표시 시간만 맞추고 videoEnded()를 호출하지 않습니다.
        placeholderTimerRef.current = window.setTimeout(() => {
          setVideo((active) => active?.commandId === next.commandId ? null : active);
        }, next.durationMs);
      }
    });

    helper.on('videoStop', ({ commandId }) => {
      clearPlaceholder();
      setVideo((active) => active?.commandId === commandId ? null : active);
      addActivity('비디오 정지');
    });

    // 등록하지 않은 메시지까지 모두 받고 싶다면 catch-all 리스너도 함께
    // 쓸 수 있습니다(구버전 방식, deprecated).
    helper.on('message', (payload, envelope) => {
      if (envelope.messageName !== 'announce') {
        addActivity(`메시지 ${envelope.messageName}: ${JSON.stringify(payload)}`);
      }
    });

    return () => {
      clearPlaceholder();
      helper.destroy();
      helperRef.current = null;
    };
  }, [addActivity]);

  const trigger = useCallback((event: string) => {
    helperRef.current?.trigger(event, { source: 'helper-react-template', at: Date.now() });
    addActivity(`트리거 전송: ${event}`);
  }, [addActivity]);

  const refreshTimer = useCallback(async () => {
    try {
      const value = await helperRef.current?.getRemainingTime({ resync: true });
      setRemainingMs(value ?? null);
      addActivity('타이머를 갱신했습니다.');
    } catch (error) {
      addActivity(`타이머 오류: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [addActivity]);

  const finishVideo = useCallback((commandId: string, failed = false) => {
    const helper = helperRef.current;
    if (!helper) return;
    // 실제 파일은 반드시 종료 또는 실패를 보고해야 기다리는 시퀀스가 진행됩니다.
    if (failed) helper.videoError(commandId);
    else helper.videoEnded(commandId);
    setVideo((active) => active?.commandId === commandId ? null : active);
    addActivity(failed ? '비디오 실패 보고' : '비디오 종료 보고');
  }, [addActivity]);

  return { subtitle, video, activities, remainingMs, trigger, refreshTimer, finishVideo };
}
