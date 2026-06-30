import { toPng } from "html-to-image"

export async function downloadElementAsImage(
  elementId: string,
  filename: string,
  scale: number = 2
): Promise<void> {
  const element = document.getElementById(elementId)
  if (!element) {
    console.error(`Element ${elementId} not found`)
    return
  }
  try {
    const dataUrl = await toPng(element, {
      pixelRatio: scale,
      cacheBust: true,
    })
    const link = document.createElement("a")
    link.download = `${filename}.png`
    link.href = dataUrl
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } catch (err) {
    console.error("Download failed:", err)
    throw err
  }
}

export async function downloadMultipleAsImages(
  elementIds: string[],
  filenamePrefix: string
): Promise<void> {
  for (let i = 0; i < elementIds.length; i++) {
    await downloadElementAsImage(
      elementIds[i]!,
      `${filenamePrefix}-${i + 1}`,
      2
    )
    await new Promise(resolve => setTimeout(resolve, 600))
  }
}
