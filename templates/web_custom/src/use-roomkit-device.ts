import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionStatus, SessionState } from '@roomkit/client';
import {
  RoomKitDevice,
  type DeviceConfig,
  type SubtitleState,
  type VideoState,
  type WebsiteState,
} from './roomkit-device';

export function useRoomKitDevice(config: DeviceConfig) {
  const deviceRef = useRef<RoomKitDevice | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string>();
  const [session, setSession] = useState<SessionState | null>(null);
  const [subtitle, setSubtitle] = useState<SubtitleState | null>(null);
  const [video, setVideo] = useState<VideoState | null>(null);
  const [website, setWebsite] = useState<WebsiteState | null>(null);
  const [hintCode, setHintCode] = useState<{ code: string; css: string } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const log = useCallback((message: string) => {
    setLogs((items) => [`${new Date().toLocaleTimeString()} ${message}`, ...items].slice(0, 12));
  }, []);

  useEffect(() => {
    const device = new RoomKitDevice(config, {
      onStatus: (next, detail) => { setStatus(next); setStatusDetail(detail); },
      onSession: setSession,
      onSubtitle: setSubtitle,
      onVideo: setVideo,
      onWebsite: setWebsite,
      onHintCode: setHintCode,
      onLog: log,
    });
    deviceRef.current = device;
    return () => {
      device.destroy();
      deviceRef.current = null;
    };
  }, [config, log]);

  const trigger = useCallback((event: string) => deviceRef.current?.trigger(event), []);
  const navigationLoaded = useCallback(
    (commandId: string) => deviceRef.current?.navigationLoaded(commandId),
    [],
  );
  const finishVideo = useCallback(
    (commandId: string, failed?: boolean) => deviceRef.current?.finishVideo(commandId, failed),
    [],
  );

  return {
    status,
    statusDetail,
    session,
    subtitle,
    video,
    website,
    hintCode,
    logs,
    trigger,
    navigationLoaded,
    finishVideo,
  };
}
