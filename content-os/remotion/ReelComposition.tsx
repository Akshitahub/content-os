import { AbsoluteFill, Audio, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { z } from "zod"

export const reelSceneInputSchema = z.object({
  imageUrl: z.string(),
  audioUrl: z.string().nullable(),
  text: z.string(),
  durationSeconds: z.number(),
})

export const reelCompositionSchema = z.object({
  scenes: z.array(reelSceneInputSchema),
  musicUrl: z.string(),
})

export type ReelSceneInput = z.infer<typeof reelSceneInputSchema>
export type ReelCompositionProps = z.infer<typeof reelCompositionSchema>

function KenBurnsScene({ scene }: { scene: ReelSceneInput }) {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()

  // Subtle zoom + pan over the scene's full duration — clamped so the
  // effect never reverses if this scene runs longer than expected.
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.15], { extrapolateRight: "clamp" })
  const translateX = interpolate(frame, [0, durationInFrames], [0, -20], { extrapolateRight: "clamp" })

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${scale}) translateX(${translateX}px)` }}>
        <Img src={scene.imageUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>

      {/* Readable caption — the scene's voiceover/text-overlay content */}
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 140 }}>
        <div
          style={{
            maxWidth: "85%",
            padding: "18px 26px",
            borderRadius: 18,
            backgroundColor: "rgba(0,0,0,0.55)",
            color: "white",
            fontSize: 44,
            fontWeight: 700,
            textAlign: "center",
            lineHeight: 1.3,
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          {scene.text}
        </div>
      </AbsoluteFill>

      {scene.audioUrl && <Audio src={scene.audioUrl} />}
    </AbsoluteFill>
  )
}

/**
 * Renders each scene for exactly its own duration_seconds (converted to
 * frames via the composition's fps), with a Ken Burns image effect,
 * readable caption text, and that scene's own TTS voiceover — plus a
 * single background-music track layered under the whole video at low
 * volume. See remotion/Root.tsx for how durationInFrames is derived from
 * the scenes' total length.
 */
export function ReelComposition({ scenes, musicUrl }: ReelCompositionProps) {
  const { fps } = useVideoConfig()
  let startFrame = 0

  return (
    <AbsoluteFill>
      {scenes.map((scene, i) => {
        const durationInFrames = Math.max(1, Math.round(scene.durationSeconds * fps))
        const from = startFrame
        startFrame += durationInFrames
        return (
          <Sequence key={i} from={from} durationInFrames={durationInFrames}>
            <KenBurnsScene scene={scene} />
          </Sequence>
        )
      })}
      {musicUrl && <Audio src={musicUrl} volume={0.12} />}
    </AbsoluteFill>
  )
}
