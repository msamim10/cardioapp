import AsyncStorage from '@react-native-async-storage/async-storage';

export const CAMERA_EXPLANATION_SEEN_KEY =
  '@cardiosurf/camera-explanation-seen:v1';

export async function hasSeenCameraExplanation(): Promise<boolean> {
  return (await AsyncStorage.getItem(CAMERA_EXPLANATION_SEEN_KEY)) === 'true';
}

export async function markCameraExplanationSeen(): Promise<void> {
  await AsyncStorage.setItem(CAMERA_EXPLANATION_SEEN_KEY, 'true');
}
