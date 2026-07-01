import { toPng } from "html-to-image"

export async function downloadElementAsImage(
  elementId: string,
  filename: string,
  scale: number = 2
): Promise<boolean> {
  const element = document.getElementById(elementId)
  if (!element) {
    console.error(`[download] Element "${elementId}" not found in DOM`)
    return false
  }
  try {
    const dataUrl = await toPng(element, {
      pixelRatio: scale,
      cacheBust: true,
      backgroundColor: "#ffffff",
      filter: (node: Element) => {
        const tag = (node as HTMLElement).tagName
        return tag !== "LINK"
      },
    })
    if (!dataUrl || dataUrl === "data:,") {
      console.error("[download] toPng returned an empty image")
      return false
    }
    const link = document.createElement("a")
    link.download = `${filename}.png`
    link.href = dataUrl
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    return true
  } catch (err) {
    console.error("[download] toPng failed:", err)
    return false
  }
}

export async function downloadMultipleAsImages(
  elementIds: string[],
  filenamePrefix: string
): Promise<boolean> {
  let allOk = true
  for (let i = 0; i < elementIds.length; i++) {
    const ok = await downloadElementAsImage(
      elementIds[i]!,
      `${filenamePrefix}-${i + 1}`,
      2
    )
    if (!ok) allOk = false
    if (i < elementIds.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 600))
    }
  }
  return allOk
}
