import { Composition } from "remotion"
import { ReelComposition, reelCompositionSchema, type ReelCompositionProps } from "./ReelComposition"

const FPS = 30
const WIDTH = 1080
const HEIGHT = 1920
const FALLBACK_DURATION_SECONDS = 15

const defaultProps: ReelCompositionProps = { scenes: [], musicUrl: "" }

export function RemotionRoot() {
  return (
    <Composition
      id="ReelVideo"
      component={ReelComposition}
      schema={reelCompositionSchema}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * FALLBACK_DURATION_SECONDS}
      defaultProps={defaultProps}
      calculateMetadata={async ({ props }) => {
        const totalSeconds = props.scenes.reduce((sum, s) => sum + s.durationSeconds, 0) || FALLBACK_DURATION_SECONDS
        return { durationInFrames: Math.max(1, Math.round(totalSeconds * FPS)) }
      }}
    />
  )
}
