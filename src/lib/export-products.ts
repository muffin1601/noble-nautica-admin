import JSZip from "jszip"
import type { Product } from "@/lib/supabase"

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "product"

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`

const extFromUrl = (url: string, mime?: string) => {
  const m = url.split("?")[0].match(/\.([a-zA-Z0-9]{2,5})$/)
  if (m) return m[1].toLowerCase()
  if (mime?.includes("/")) return mime.split("/")[1].replace("jpeg", "jpg").split("+")[0]
  return "jpg"
}

/**
 * Builds a zip containing products.json, products.csv and an images/ folder
 * (one sub-folder per product), then triggers a browser download.
 */
export async function downloadProductsBundle(
  products: Product[],
  onProgress?: (done: number, total: number) => void
): Promise<{ failedImages: number }> {
  const zip = new JSZip()

  zip.file("products.json", JSON.stringify(products, null, 2))

  const header = ["id", "name", "category", "subcategory", "status", "description", "models", "images", "created_at", "updated_at"]
  const rows = products.map((p) =>
    [
      p.id, p.name, p.category, (p as { subcategory?: string }).subcategory, p.status, p.description,
      p.data?.models?.length || 0, p.data?.images?.length || 0, (p as { created_at?: string }).created_at, p.updated_at,
    ].map(csvCell).join(",")
  )
  zip.file("products.csv", "﻿" + [header.join(","), ...rows].join("\n"))

  const jobs: { folder: string; url: string; index: number }[] = []
  for (const p of products) {
    const folder = `images/${p.id}-${slug(p.name)}`
    ;(p.data?.images || []).forEach((url: string, i: number) => jobs.push({ folder, url, index: i + 1 }))
  }

  let done = 0
  let failed = 0
  const queue = [...jobs]
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const res = await fetch(job.url)
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        zip.file(`${job.folder}/${job.index}.${extFromUrl(job.url, blob.type)}`, blob)
      } catch {
        failed++
      }
      onProgress?.(++done, jobs.length)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))

  const blob = await zip.generateAsync({ type: "blob" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `products-${new Date().toISOString().slice(0, 10)}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)

  return { failedImages: failed }
}
