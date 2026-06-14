export function Lighting() {
  return (
    <>
      {/* Strong bright ambient flattens shadows for a cartoon look */}
      <ambientLight intensity={1.0} color="#fff4dc" />
      {/* Warm overhead sun, soft because no shadow casting */}
      <directionalLight
        position={[5, 12, 4]}
        intensity={1.15}
        color="#ffe2a8"
      />
      {/* A second cooler fill from opposite side for that bright daytime feel */}
      <directionalLight
        position={[-6, 6, -2]}
        intensity={0.45}
        color="#bee0ff"
      />
      {/* Sky bounce + warm gravel ground bounce */}
      <hemisphereLight args={['#9ed7f5', '#8a7a63', 0.55]} />
    </>
  );
}
