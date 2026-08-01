export interface MusicOption {
  id: string
  label: string
  url: string | null
}

export const MUSIC_OPTIONS: MusicOption[] = [
  { id: "upbeat", label: "Upbeat", url: "/audio/music-upbeat.mp3" },
  { id: "calm", label: "Calm", url: "/audio/music-calm.mp3" },
  { id: "corporate", label: "Corporate", url: "/audio/music-corporate.mp3" },
  { id: "none", label: "No music", url: null },
]
