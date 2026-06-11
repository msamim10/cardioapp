import {
  LANE_X,
  TRAIN_MODEL,
  TRAIN_ROTATION_Y,
  TRAIN_SCALE,
  type Lane,
} from './gameplayConstants';
import { GlbModel } from './GlbModel';

type Props = {
  lane: Lane;
  z: number;
};

export function TrainObstacle({ lane, z }: Props) {
  return (
    <GlbModel
      assetModule={TRAIN_MODEL}
      position={[LANE_X[lane], 0, z]}
      rotation={[0, TRAIN_ROTATION_Y, 0]}
      scale={TRAIN_SCALE}
    />
  );
}
