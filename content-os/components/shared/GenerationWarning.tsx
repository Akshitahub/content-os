export function GenerationWarning({ isPending }: { isPending: boolean }) {
  if (!isPending) return null
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 mb-4">
      <p className="text-sm text-amber-700 font-medium">
        ⚠️ Generation in progress — please stay on this tab to see your results
      </p>
    </div>
  )
}
