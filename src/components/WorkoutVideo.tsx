import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

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
  const player = useVideoPlayer({ uri: source, contentType: 'hls' }, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.5;
    instance.play();
  });

  useEffect(() => {
    const endSub = player.addListener('playToEnd', onEnd);
    const timeSub = player.addListener('timeUpdate', (event) => {
      const duration = player.duration;
      if (duration > 0) onProgress(Math.min(1, event.currentTime / duration));
    });
    const statusSub = player.addListener('statusChange', (event) => {
      if (event.status === 'error') onStatusChange('error');
      else if (event.status === 'readyToPlay') onStatusChange('ready');
      else if (event.status === 'loading') onStatusChange('loading');
    });

    return () => {
      endSub.remove();
      timeSub.remove();
      statusSub.remove();
    };
  }, [onEnd, onProgress, onStatusChange, player]);

  return (
    <VideoView
      style={StyleSheet.absoluteFill}
      player={player}
      contentFit="cover"
      nativeControls={false}
    />
  );
}
