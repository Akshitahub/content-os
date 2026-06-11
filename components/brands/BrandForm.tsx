"use client"

import { useState } from "react"
import { useForm, type SubmitHandler } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { X, Plus, Loader2 } from "lucide-react"
import { createBrandSchema } from "@/lib/validations/brand"
import type { CreateBrandInput } from "@/lib/validations/brand"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface BrandFormProps {
  defaultValues?: Partial<CreateBrandInput>
  onSubmit: (data: CreateBrandInput) => Promise<void>
  submitLabel?: string
  isLoading?: boolean
  error?: string | null
}

function TagInput({
  value,
  onChange,
  placeholder,
  maxTags = 10,
}: {
  value: string[]
  onChange: (val: string[]) => void
  placeholder?: string
  maxTags?: number
}) {
  const [input, setInput] = useState("")

  function addTag() {
    const trimmed = input.trim()
    if (!trimmed || value.includes(trimmed) || value.length >= maxTags) return
    onChange([...value, trimmed])
    setInput("")
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      addTag()
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={addTag}
          disabled={!input.trim() || value.length >= maxTags}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              {tag}
              <button type="button" onClick={() => removeTag(tag)} className="ml-0.5 rounded-full hover:text-primary/70">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function BrandForm({ defaultValues, onSubmit, submitLabel = "Save brand", isLoading = false, error }: BrandFormProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<CreateBrandInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(createBrandSchema) as any,
    defaultValues: {
      name: "",
      description: "",
      niche: "",
      target_audience: "",
      tone_of_voice: "",
      brand_values: [],
      competitors: [],
      website_url: "",
      instagram_handle: "",
      ai_persona: "",
      ...defaultValues,
    },
  })

  const brandValues = watch("brand_values") ?? []
  const competitors = watch("competitors") ?? []

  const onValidSubmit: SubmitHandler<CreateBrandInput> = async (data) => {
    await onSubmit({
      ...data,
      brand_values: data.brand_values ?? [],
      competitors: data.competitors ?? [],
    })
  }

  return (
    <form onSubmit={handleSubmit(onValidSubmit)} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand identity</CardTitle>
          <CardDescription>The basics the AI uses to understand who you are.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Brand name <span className="text-destructive">*</span></Label>
            <Input id="name" placeholder="e.g. Kama Ayurveda" {...register("name")} aria-invalid={!!errors.name} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Short description</Label>
            <Input id="description" placeholder="What does your brand do in one sentence?" {...register("description")} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="niche">Niche / Industry</Label>
              <Input id="niche" placeholder="e.g. Luxury skincare" {...register("niche")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="instagram_handle">Instagram handle</Label>
              <div className="flex items-center">
                <span className="flex h-10 items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">@</span>
                <Input id="instagram_handle" placeholder="yourbrand" className="rounded-l-none" {...register("instagram_handle")} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="website_url">Website URL</Label>
            <Input id="website_url" type="url" placeholder="https://yourbrand.com" {...register("website_url")} aria-invalid={!!errors.website_url} />
            {errors.website_url && <p className="text-xs text-destructive">{errors.website_url.message}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audience & tone</CardTitle>
          <CardDescription>The more specific you are, the better the AI content will be.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="target_audience">Target audience</Label>
            <Input id="target_audience" placeholder="e.g. Women 25–40, health-conscious, urban" {...register("target_audience")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tone_of_voice">Tone of voice</Label>
            <Input id="tone_of_voice" placeholder="e.g. Warm, knowledgeable, aspirational but accessible" {...register("tone_of_voice")} />
          </div>

          <div className="space-y-2">
            <Label>Brand values</Label>
            <p className="text-xs text-muted-foreground">Press Enter or comma to add. Max 10.</p>
            <TagInput value={brandValues} onChange={(val) => setValue("brand_values", val)} placeholder="e.g. Sustainability, Authenticity..." />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Competitive context</CardTitle>
          <CardDescription>Helps the AI differentiate your content from competitors.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label>Competitors</Label>
            <p className="text-xs text-muted-foreground">Brand names you compete with. Max 10.</p>
            <TagInput value={competitors} onChange={(val) => setValue("competitors", val)} placeholder="e.g. Forest Essentials, Nykaa..." />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI persona (optional)</CardTitle>
          <CardDescription>
            Describe how you want the AI to &quot;think&quot; as your brand.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="ai_persona">Persona prompt</Label>
            <textarea
              id="ai_persona"
              rows={4}
              placeholder="e.g. You are a warm, knowledgeable guide who believes in the healing power of nature..."
              className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              {...register("ai_persona")}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={isLoading} className="min-w-32">
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
