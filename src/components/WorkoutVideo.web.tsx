import HlsClient, { Events } from 'hls.js';
import { createElement, useEffect, useRef } from 'react';

type WorkoutVideoProps = {
  source: string;
  onEnd: () => void;
  onProgress: (progress: number) => void;
  onStatusChange: (status: 'loading' | 'ready' | 'error') => void;
};

export function WorkoutVideo({
  source,
  onEnd,
  onProgress,
  onStatusChange,
}: WorkoutVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateProgress = () => {
      if (video.duration > 0) onProgress(Math.min(1, video.currentTime / video.duration));
    };
    const play = () => {
      onStatusChange('ready');
      void video.play();
    };
    const fail = () => onStatusChange('error');

    video.addEventListener('ended', onEnd);
    video.addEventListener('timeupdate', updateProgress);

    let hls: HlsClient | undefined;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source;
      video.addEventListener('canplay', play);
      video.addEventListener('error', fail);
    // hls.js exposes feature detection as a static class method.
    // eslint-disable-next-line import/no-named-as-default-member
    } else if (HlsClient.isSupported()) {
      hls = new HlsClient();
      hls.attachMedia(video);
      hls.on(Events.MEDIA_ATTACHED, () => hls?.loadSource(source));
      hls.on(Events.MANIFEST_PARSED, play);
      hls.on(Events.ERROR, (_event, data) => {
        if (data.fatal) fail();
      });
    } else {
      fail();
    }

    return () => {
      video.removeEventListener('ended', onEnd);
      video.removeEventListener('timeupdate', updateProgress);
      video.removeEventListener('canplay', play);
      video.removeEventListener('error', fail);
      hls?.destroy();
    };
  }, [onEnd, onProgress, onStatusChange, source]);

  return createElement('video', {
    ref: videoRef,
    playsInline: true,
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    },
  });
}
