export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ""
export const POSTHOG_HOST = "https://app.posthog.com"

export async function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): Promise<void> {
  if (!POSTHOG_KEY) return
  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event,
        distinct_id: distinctId,
        properties: properties ?? {},
      }),
    })
  } catch (err) {
    console.error("[analytics] captureServerEvent failed:", err)
  }
}
