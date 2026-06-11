"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { X, Plus } from "lucide-react"
import { createProductSchema, type CreateProductInput } from "@/lib/validations/product"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface ProductFormProps {
  onSubmit: (data: CreateProductInput) => Promise<void>
  onCancel: () => void
  isLoading?: boolean
}

export function ProductForm({ onSubmit, onCancel, isLoading }: ProductFormProps) {
  const [benefitInput, setBenefitInput] = useState("")
  const [benefits, setBenefits] = useState<string[]>([])

  const { register, handleSubmit, formState: { errors }, setValue } = useForm<CreateProductInput>({
    resolver: zodResolver(createProductSchema),
    defaultValues: { currency: "INR", key_benefits: [], image_urls: [] },
  })

  function addBenefit() {
    const trimmed = benefitInput.trim()
    if (!trimmed || benefits.includes(trimmed)) return
    const updated = [...benefits, trimmed]
    setBenefits(updated)
    setValue("key_benefits", updated)
    setBenefitInput("")
  }

  function removeBenefit(b: string) {
    const updated = benefits.filter((x) => x !== b)
    setBenefits(updated)
    setValue("key_benefits", updated)
  }

  async function handleFormSubmit(data: CreateProductInput) {
    await onSubmit({ ...data, key_benefits: benefits })
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 space-y-1.5">
          <Label htmlFor="name">Product name <span className="text-destructive">*</span></Label>
          <Input id="name" placeholder="e.g. Vitamin C Serum 30ml" {...register("name")} />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>

        <div className="sm:col-span-2 space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <textarea
            id="description"
            rows={3}
            placeholder="What does this product do? Who is it for?"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            {...register("description")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="price">Price</Label>
          <Input id="price" type="number" step="0.01" placeholder="999" {...register("price", { valueAsNumber: true })} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <Input id="category" placeholder="e.g. Skincare, Supplements" {...register("category")} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="target_customer">Target customer</Label>
          <Input id="target_customer" placeholder="e.g. Women 25-40 with oily skin" {...register("target_customer")} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ingredients">Ingredients / Materials</Label>
          <Input id="ingredients" placeholder="e.g. 10% Vitamin C, Niacinamide" {...register("ingredients")} />
        </div>

        <div className="sm:col-span-2 space-y-1.5">
          <Label>Key benefits</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Add a benefit and press Enter"
              value={benefitInput}
              onChange={(e) => setBenefitInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBenefit() } }}
            />
            <Button type="button" variant="outline" size="sm" onClick={addBenefit}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {benefits.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {benefits.map((b) => (
                <span key={b} className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                  {b}
                  <button type="button" onClick={() => removeBenefit(b)} className="ml-0.5 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>Cancel</Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Saving…" : "Save product"}
        </Button>
      </div>
    </form>
  )
}
