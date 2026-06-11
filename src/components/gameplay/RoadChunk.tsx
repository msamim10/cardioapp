import {
  ROAD_MODEL,
  ROAD_SCALE,
  TUNNEL_MODEL,
  TUNNEL_SCALE,
  type GameplayChunk,
} from './gameplayConstants';
import { GlbModel } from './GlbModel';
import { TrainObstacle } from './TrainObstacle';

type Props = {
  chunk: GameplayChunk;
};

export function RoadChunk({ chunk }: Props) {
  const assetModule = chunk.kind === 'tunnel' ? TUNNEL_MODEL : ROAD_MODEL;
  const scale = chunk.kind === 'tunnel' ? TUNNEL_SCALE : ROAD_SCALE;

  return (
    <group position={[0, 0, chunk.z]}>
      <GlbModel assetModule={assetModule} scale={scale} />
      {chunk.trainLane !== null && (
        <TrainObstacle lane={chunk.trainLane} z={chunk.trainOffsetZ} />
      )}
    </group>
  );
}
