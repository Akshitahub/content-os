import { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard/", "/brands/", "/settings/"],
    },
    sitemap: "https://content-os-mu-kohl.vercel.app/sitemap.xml",
  }
}
