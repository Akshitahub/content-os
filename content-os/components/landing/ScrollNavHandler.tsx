"use client"

import { useEffect } from "react"

export function ScrollNavHandler() {
  useEffect(() => {
    const handleScroll = () => {
      const nav = document.getElementById("landing-nav")
      if (!nav) return
      if (window.scrollY > 60) {
        nav.style.backgroundColor = "#ffffff"
        nav.style.borderBottom = "1px solid #e5e7eb"
        nav.querySelectorAll(".nav-logo-light").forEach((el) => {
          ;(el as HTMLElement).style.display = "flex"
        })
        nav.querySelectorAll(".nav-logo-dark").forEach((el) => {
          ;(el as HTMLElement).style.display = "none"
        })
        nav.querySelectorAll(".nav-link").forEach((el) => {
          ;(el as HTMLElement).style.color = "#374151"
        })
      } else {
        nav.style.backgroundColor = "transparent"
        nav.style.borderBottom = "none"
        nav.querySelectorAll(".nav-logo-light").forEach((el) => {
          ;(el as HTMLElement).style.display = "none"
        })
        nav.querySelectorAll(".nav-logo-dark").forEach((el) => {
          ;(el as HTMLElement).style.display = "flex"
        })
        nav.querySelectorAll(".nav-link").forEach((el) => {
          ;(el as HTMLElement).style.color = "#ffffff"
        })
      }
    }
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])
  return null
}
