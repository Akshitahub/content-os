export function ComingSoonBadge({ className }: { className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ${className ?? ""}`}
    >
      Coming soon
    </span>
  )
}
