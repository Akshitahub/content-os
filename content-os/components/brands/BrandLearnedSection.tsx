"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { isApiError } from "@/types/api"
import { readJsonResponse } from "@/lib/utils/read-json-response"

// "What SocioPosts has learned": lessons from the brand's own results
// (what got saved and shared) and from the owner's own edits. Each one
// steers future posts; the owner can remove any of them. Hidden until
// there is something learned.

interface Lesson { id: string; kind: "do" | "avoid"; rule: string; source: "performance" | "edits"; evidence_count: number }

const key = (brandId: string) => ["brand-lessons", brandId] as const

async function readData<T>(res: Response, fallback: string): Promise<T> {
  const json: unknown = await readJsonResponse(res)
  if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : fallback)
  return (json as { data: T }).data
}

export function BrandLearnedSection({ brandId }: { brandId: string }) {
  const queryClient = useQueryClient()
  const { data: lessons } = useQuery({
    queryKey: key(brandId),
    queryFn: async () => (await readData<{ lessons: Lesson[] }>(await fetch(`/api/v1/brands/${brandId}/lessons`), "Couldn't load what we've learned.")).lessons,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => readData(await fetch(`/api/v1/brands/${brandId}/lessons/${id}`, { method: "DELETE" }), "Couldn't remove that. Please try again."),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key(brandId) })
      const previous = queryClient.getQueryData<Lesson[]>(key(brandId))
      queryClient.setQueryData<Lesson[]>(key(brandId), (old) => old?.filter((l) => l.id !== id))
      return { previous }
    },
    onError: (_err, _id, context) => queryClient.setQueryData(key(brandId), context?.previous),
  })

  if (!lessons?.length) return null
  const groups: [string, Lesson[]][] = [
    ["From your results", lessons.filter((l) => l.source === "performance")],
    ["From your edits", lessons.filter((l) => l.source === "edits")],
  ]

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm">What SocioPosts has learned</CardTitle>
        <CardDescription>What your posts&apos; saves and shares, and your own edits, have taught us. Remove anything that doesn&apos;t sound right.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.filter(([, ls]) => ls.length > 0).map(([label, ls]) => (
          <div key={label}>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <ul className="mt-1 space-y-1">
              {ls.map((l) => (
                <li key={l.id} className="group flex items-start gap-2 text-sm">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${l.kind === "do" ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
                  <span className="flex-1">{l.rule}</span>
                  <button type="button" aria-label="Remove this lesson" title="Remove -- it won't steer your posts any more"
                    onClick={() => remove.mutate(l.id)}
                    className="rounded p-0.5 text-muted-foreground opacity-60 hover:bg-muted hover:opacity-100 focus:opacity-100">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {remove.error && <p className="text-xs text-destructive">{remove.error.message}</p>}
      </CardContent>
    </Card>
  )
}
