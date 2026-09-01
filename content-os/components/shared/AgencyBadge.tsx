export function AgencyBadge({ className }: { className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ${className ?? ""}`}
    >
      Agency
    </span>
  )
}
