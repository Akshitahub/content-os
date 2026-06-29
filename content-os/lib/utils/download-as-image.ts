import html2canvas from "html2canvas"

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
    const canvas = await html2canvas(element, {
      scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
      logging: false,
    })
    const dataUrl = canvas.toDataURL("image/png", 1.0)
    const link = document.createElement("a")
    link.download = `${filename}.png`
    link.href = dataUrl
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } catch (err) {
    console.error("Download failed:", err)
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
