import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeviceConfig, VideoState } from './roomkit-device';
import { useRoomKitDevice } from './use-roomkit-device';

const STORAGE_KEY = 'roomkit.web-custom.config';

export function App() {
  const [config, setConfig] = useState<DeviceConfig | null>(() => configuredDefaults());
  if (!config) return <Configuration onConnect={setConfig} />;
  return <DeviceScreen config={config} onConfigure={() => setConfig(null)} />;
}

function Configuration({ onConnect }: { onConnect: (config: DeviceConfig) => void }) {
  const [serverUrl, setServerUrl] = useState(import.meta.env.VITE_ROOMKIT_SERVER_URL ?? 'http://localhost:3000');
  const [deviceCode, setDeviceCode] = useState(import.meta.env.VITE_ROOMKIT_DEVICE_CODE ?? '');
  const [deviceName, setDeviceName] = useState(import.meta.env.VITE_ROOMKIT_DEVICE_NAME ?? 'React 커스텀 화면');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const config = { serverUrl: serverUrl.trim(), deviceCode: deviceCode.trim(), deviceName: deviceName.trim() };
    if (!config.serverUrl || !config.deviceCode) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    onConnect(config);
  };

  return (
    <main className="configuration">
      <form onSubmit={submit}>
        <p className="eyebrow">ROOMKIT DIRECT CLIENT</p>
        <h1>장치 연결</h1>
        <label>서버 URL<input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} /></label>
        <label>장치 또는 테스트 코드<input value={deviceCode} onChange={(e) => setDeviceCode(e.target.value)} autoFocus /></label>
        <label>장치 이름<input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} /></label>
        <button type="submit">연결하기</button>
      </form>
    </main>
  );
}

function DeviceScreen({ config, onConfigure }: { config: DeviceConfig; onConfigure: () => void }) {
  const stableConfig = useMemo(() => config, [config]);
  const device = useRoomKitDevice(stableConfig);
  const [trigger, setTrigger] = useState('screen:ready');

  return (
    <main className="device-stage">
      {device.website ? (
        <iframe
          key={`${device.website.command.id}:${device.website.key}`}
          className="website"
          src={device.website.command.url}
          title="RoomKit website"
          onLoad={() => device.navigationLoaded(device.website!.command.id)}
        />
      ) : (
        <section className="idle-screen">
          <p className="eyebrow">ROOMKIT CUSTOM SCREEN</p>
          <h1>장치가 준비되었습니다.</h1>
          <p>Studio에서 웹사이트 이동 또는 미디어 커맨드를 보내 주세요.</p>
        </section>
      )}

      <VideoLayer state={device.video} finish={device.finishVideo} />

      {device.subtitle && (
        <section className="subtitle rk-subtitle" aria-live="polite">
          <style>{device.subtitle.css}</style>
          <div dangerouslySetInnerHTML={{ __html: device.subtitle.html }} />
          <small>{device.subtitle.lineIndex + 1}/{device.subtitle.lineCount}</small>
        </section>
      )}

      {device.hintCode && (
        <aside className="hint-code rk-hint-code">
          <style>{device.hintCode.css}</style>
          <span>힌트 코드</span><strong>{device.hintCode.code}</strong>
        </aside>
      )}

      <aside className="debug-panel">
        <header>
          <span className={`connection connection-${device.status}`}>{device.status}</span>
          <button onClick={onConfigure}>연결 변경</button>
        </header>
        <p>{device.statusDetail ?? config.deviceName}</p>
        <p>세션: {device.session?.state ?? '대기'} · 모드: {device.session?.mode ?? '-'}</p>
        <form onSubmit={(e) => { e.preventDefault(); device.trigger(trigger); }}>
          <input value={trigger} onChange={(e) => setTrigger(e.target.value)} aria-label="트리거 이름" />
          <button>트리거</button>
        </form>
        <div className="logs">{device.logs.map((log) => <p key={log}>{log}</p>)}</div>
      </aside>
    </main>
  );
}

function VideoLayer({ state, finish }: { state: VideoState | null; finish: (id: string, failed?: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!state?.command.url || !videoRef.current) return;
    void videoRef.current.play().catch(() => finish(state.command.id, true));
  }, [finish, state]);

  if (!state) return null;
  const { command } = state;
  const style = command.frame
    ? { left: `${command.frame.x}%`, top: `${command.frame.y}%`, width: `${command.frame.width}%`, height: `${command.frame.height}%` }
    : { inset: '0' };
  return (
    <section className="video-layer" style={style}>
      {command.url ? (
        <video
          key={command.id}
          ref={videoRef}
          src={command.url}
          playsInline
          onEnded={() => finish(command.id)}
          onError={() => finish(command.id, true)}
        />
      ) : (
        <div className="video-placeholder"><strong>{command.assetName}</strong><span>플레이스홀더</span></div>
      )}
    </section>
  );
}

function configuredDefaults(): DeviceConfig | null {
  const envUrl = import.meta.env.VITE_ROOMKIT_SERVER_URL;
  const envCode = import.meta.env.VITE_ROOMKIT_DEVICE_CODE;
  if (envUrl && envCode) return { serverUrl: envUrl, deviceCode: envCode, deviceName: import.meta.env.VITE_ROOMKIT_DEVICE_NAME ?? 'React 커스텀 화면' };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) as DeviceConfig : null;
  } catch {
    return null;
  }
}
