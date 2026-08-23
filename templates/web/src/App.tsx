import { useEffect, useRef } from 'react';
import { useRoomKitHelper, type DelegatedVideo, type Subtitle } from './use-roomkit-helper';

export function App() {
  const roomkit = useRoomKitHelper();

  return (
    <main className="stage">
      <section className="puzzle">
        <p className="eyebrow">ROOMKIT HELPER TEMPLATE</p>
        <h1>관측 기록 보관소</h1>
        <p className="description">Player가 보내는 자막과 비디오를 이 React 화면에서 직접 렌더링합니다.</p>
        <div className="actions">
          <button onClick={() => roomkit.trigger('archive:opened')}>보관소 열기</button>
          <button onClick={() => roomkit.trigger('archive:solved')}>해결 트리거</button>
          <button onClick={roomkit.refreshTimer}>남은 시간 확인</button>
        </div>
        <strong className="timer">{formatRemaining(roomkit.remainingMs)}</strong>
      </section>

      <VideoLayer video={roomkit.video} onFinish={roomkit.finishVideo} />
      <SubtitleLayer subtitle={roomkit.subtitle} />

      <aside className="activity">
        <h2>Helper 활동</h2>
        {roomkit.activities.length === 0
          ? <p>웹 테스트에서 커맨드를 보내 주세요.</p>
          : roomkit.activities.map((item) => <p key={item.id}>{item.text}</p>)}
      </aside>
    </main>
  );
}

function SubtitleLayer({ subtitle }: { subtitle: Subtitle }) {
  if (!subtitle) return null;
  const align = subtitle.params.align === 'left' || subtitle.params.align === 'right'
    ? subtitle.params.align
    : 'center';
  const speaker = typeof subtitle.params.speaker === 'string' ? subtitle.params.speaker : null;

  return (
    <section className="custom-subtitle" data-align={align} aria-live="polite">
      {/* Studio에서 작성한 자막 CSS는 신뢰된 관리자 입력으로 현재 자막에만 적용합니다. */}
      <style>{subtitle.css}</style>
      {speaker && <span className="custom-subtitle-speaker">{speaker}</span>}
      <div
        className="custom-subtitle-content rk-subtitle"
        dangerouslySetInnerHTML={{ __html: subtitle.html }}
      />
      <small>{subtitle.lineIndex + 1} / {subtitle.lineCount}</small>
    </section>
  );
}

function VideoLayer({
  video,
  onFinish,
}: {
  video: DelegatedVideo | null;
  onFinish: (commandId: string, failed?: boolean) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!video?.url || !ref.current) return;
    // 자동 재생이 브라우저 정책으로 거부되어도 실패 ack를 보내 시퀀스가 멈추지 않게 합니다.
    void ref.current.play().catch(() => onFinish(video.commandId, true));
  }, [onFinish, video]);

  if (!video) return null;
  const frame = video.frame;
  const style = frame
    ? { left: `${frame.x}%`, top: `${frame.y}%`, width: `${frame.width}%`, height: `${frame.height}%` }
    : { inset: '0' };
  const objectFit = video.params.objectFit === 'contain' ? 'contain' : 'cover';
  const muted = video.params.muted === true;

  return (
    <section className="custom-video" style={style}>
      {video.url ? (
        <video
          key={video.commandId}
          ref={ref}
          src={video.url}
          style={{ objectFit }}
          muted={muted}
          playsInline
          onEnded={() => onFinish(video.commandId)}
          onError={() => onFinish(video.commandId, true)}
        />
      ) : (
        <div className="video-placeholder">
          <strong>{video.assetName}</strong>
          <span>플레이스홀더 · {Math.round((video.durationMs ?? 0) / 100) / 10}초</span>
        </div>
      )}
    </section>
  );
}

function formatRemaining(ms: number | null) {
  if (ms === null) return '타이머 정보 없음';
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
