import { Config } from "@remotion/cli/config"

// Entry point for `npx remotion studio` / `npx remotion render` during
// local development. Production rendering is not wired up yet — see
// lib/video/render-trigger.ts.
Config.setVideoImageFormat("jpeg")
Config.setEntryPoint("./remotion/index.ts")
