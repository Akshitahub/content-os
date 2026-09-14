# Functional audit — everything built in this thread

Date: 2026-09-14
Scope: every feature built across this session (occasion badges, product
thumbnails + Carousel deep-link, AdMaker saved-product selection, WhatsApp
share, Remix to Reel Script, dashboard CTA card, dashboard simplification,
content-angle/visual-style wiring, Captions multi-select + bulk delete,
carousel PNG/PDF download, and the Home dashboard hero rebuild).

**No code was changed in this pass.** All findings below are read-only —
grep/read tracing, one live read-only Supabase query, one `npx tsc --noEmit`,
one full `npm run lint`, and one full `npm run build`.

## Summary

**23 findings** — 0 [BLOCKING], 3 [BUG], 4 [MINOR], 16 [WORKS AS EXPECTED]

---

## 0. Baseline

- **[WORKS AS EXPECTED]** `npx tsc --noEmit` from `content-os/content-os/` — clean, zero output.
- **[WORKS AS EXPECTED]** `npm run lint` (full repo) — **55 problems (24 errors, 31 warnings)** total. Every file this thread touched or created was checked against its own pre-commit baseline (via `git stash` comparison) at commit time, and none show a *new* finding now — the 55 problems are the same pre-existing set spread across `ContentCalendar.tsx`, `DashboardStats.tsx`, `AdMaker.tsx`, `CarouselBuilder.tsx`, `FullPostGenerator.tsx`, the library and dashboard pages, `post-image-pipeline.ts`, plus several files never touched in this thread at all (`remotion/ReelComposition.tsx`, `scripts/purge-influencers.ts`, `lib/design/post-card-generator.ts`, `lib/usage/check-and-increment-usage.ts`, `components/brands/*`, `components/shared/GenerateVideoAction.tsx`, etc.). Every net-new file from this thread (`app/api/v1/occasions/route.ts`, `stores/generationStore.ts`, `lib/utils/carousel-export.ts`'s new export, `lib/dashboard/get-or-create-daily-draft.ts`, `lib/dashboard/get-best-hook-type.ts`, `components/dashboard/CreditBalancePill.tsx`, `components/dashboard/DetailedStatsToggle.tsx`) reports **zero** findings.
- **[MINOR]** `hooks/useGeneration.ts:205` (`useGenerateFullPostFromPhoto`) and `app/api/v1/ai/fullpost/generate-from-photo/route.ts` are now orphaned. The "remove photo-upload" commit deleted every caller of this hook from `FullPostGenerator.tsx`, but the hook itself and its backing route were never deleted. Confirmed via repo-wide grep: zero `.tsx` files import `useGenerateFullPostFromPhoto` anymore. Not broken (the route still works if hit directly), just genuinely dead weight with no UI path to it.
- **[MINOR]** `components/generate/FullPostGenerator.tsx:881` and `:1134` contain doc comments that still say *"Only true for the 'ai' image source — product_photo and user_upload have no client-editable overlay"* and *"for the product_photo/user_upload paths (which never had this decoupling in the first place)"*. `imageSource`'s type is now `"ai" | null` only (confirmed) — these paths were fully removed from the type and the JSX, so the comments describe branches that can no longer exist. Comment-only, not a functional defect, but will mislead a future reader into thinking those paths are still live.
- **[WORKS AS EXPECTED]** `grep -n "QUICK_ACTIONS" components/dashboard/DashboardStats.tsx` → zero matches. Fully removed, no leftover array or JSX block.
- **[WORKS AS EXPECTED]** `grep -n "ProductPicker\|PHOTO_CAPTION" components/generate/FullPostGenerator.tsx` → zero matches. Both fully removed.

---

## 1. Database state

- **[WORKS AS EXPECTED]** — **correcting the risk flagged in the task**: `supabase/migrations/050_daily_draft_cache.sql` **has** been run against the live database. Verified with a live, read-only query against the project's own Supabase instance (service-role client, `select id from daily_draft_cache limit 1`) — the table exists. Went further and pulled the actual rows: there are already two real rows for `draft_date = 2026-09-14` (today), one a genuine success (`hook_text`/`caption_text`/`image_url`/`content_project_id` all populated, `generation_failed: false`) and one a genuine failure (`hook_text`/`caption_text` empty, `image_url: null`, `generation_failed: true`). This means `getOrCreateDailyDraft` has already executed live, end-to-end, in both its success and failure branches — not just type-checked. **This is not blocking.**

---

## 2. Create Post

- **[WORKS AS EXPECTED]** `components/generate/FullPostGenerator.tsx:239-240` — `generatePostImageMutate`'s payload includes both `aspectRatio` and `visualStyle` side by side; neither commit clobbered the other. Both are also correctly listed in the `useCallback` dependency array at line 253.
- **[WORKS AS EXPECTED]** `components/generate/FullPostGenerator.tsx:360` — `contentAngle` is sent as its own field in the `generate()` call; the old client-side `ANGLE_HINT` map and prose-folding logic are gone (confirmed in section 0).
- **[WORKS AS EXPECTED]** `app/api/v1/ai/fullpost/generate/route.ts:21-26` — the server-side `ANGLE_HINT` map has exactly the 4 non-`"auto"` entries (`problem_solution`, `quick_tip`, `myth_contrarian`, `launch_offer`), wording copied verbatim from the original client map, each a clear, distinct instruction. Note: the task's checklist says "all five entries" — `"auto"` deliberately has no hint by design (same as the original client-side map's own `Record<Exclude<ContentAngle, "auto">, string>` type), so 4 entries is correct, not a miscount.
- **[WORKS AS EXPECTED]** `components/generate/FullPostGenerator.tsx:342-351` — `handleGenerate` synchronously resets `postImageUrl`, `imageSource`, `imageError`, `postSessionId`, `overlayText`, and `flattenedImageUrl` before calling `generate()`. Combined with `FullPostResults`' `fullPostResult && !isPending` mount gate, `PostImagePreview` genuinely unmounts and remounts on every fresh full-post generation, so its own local state (see next finding) resets correctly *for this specific path*.
- **[BUG]** `components/generate/FullPostGenerator.tsx:909` (`addingHeadline` local state) does **not** reset when `handleRegenerateImage` (the "Regenerate image" button, and the image-error "Try again" retry) runs. `handleRegenerateImage` (line 255-258) only calls `runImageGeneration` — it never touches `isPending` (that's the *text*-generation mutation's flag), so `FullPostResults`/`PostImagePreview` stay mounted throughout an image-only regenerate, and `addingHeadline`'s local state survives across it. The comment at `:943-947` claims this "resets naturally on every new PostImagePreview mount (a fresh generation)" — true for `handleGenerate`, false for `handleRegenerateImage`. Concrete failure scenario: user clicks "+ Add headline" on post A, types nothing, blurs (auto-collapses, `addingHeadline` back to `false` — fine), but if they instead *type something then delete it without blurring*, then click "Regenerate image" before blurring, `addingHeadline` stays `true` into the new image. If the regenerated image's own `suggested_overlay_text` also comes back empty, `showHeadlineEditor` (`:948`) stays `true` from the stale `addingHeadline`, so the scrim+textarea shows already-open with an empty placeholder instead of collapsing to the "+ Add headline" corner button — directly contradicting this thread's own earlier "FIX 3 — Don't show the headline placeholder/scrim when there's nothing to show."
- **[MINOR — flag for manual QA]** `components/generate/FullPostGenerator.tsx:1022-1030` — the "Download" link uses `download="post-image.png"` on an `<a>` whose `href` is either a `data:` URI (flattened/overlay case) or a plain `https://...supabase.co/...` URL (no-overlay case). The `data:` URI case reliably forces a download in every browser (same-origin by definition). The plain cross-origin storage URL case is a well-documented browser inconsistency: some browsers (notably some Chrome/Firefox versions under certain CORS header combinations) will navigate to or open the cross-origin resource in the `target="_blank"` tab instead of honoring `download`. Could not verify with a live browser in this read-only pass — flagging as a real, if narrow, risk rather than asserting either way.

---

## 3. Content Calendar

- **[WORKS AS EXPECTED]** `components/calendar/ContentCalendar.tsx:248-269` (`handleDropOnDate`) — `draggedEntryId`/`dragOverDate` are cleared synchronously at the very top of the function (`:250-251`), before any `await`, so they can never leak regardless of the PATCH's outcome. `snapshot` (`:257`) captures the pre-optimistic-update `entries` array by reference at the moment of the drop, and both the `!res.ok` and `catch` paths (`:266`, `:268`) restore it wholesale — a full revert, not a partial merge. No leaked state, no half-updated array on failure.
- **[WORKS AS EXPECTED]** `components/calendar/ContentCalendar.tsx:110-123` — the occasions-fetch `useEffect`'s dependency array is `[viewMode, currentDate]`, both genuinely stable values (`currentDate` only changes identity via explicit `setCurrentDate` calls in `navigatePrev`/`navigateNext`). It is **not** keyed on `days`/`weekDays` (which are recomputed — new array reference — on every render). Confirmed this effect only refires on an actual month/week navigation or view-mode toggle, not on every render.

---

## 4. Products and Offers

- **[WORKS AS EXPECTED]** Traced `pendingProductId`'s full lifecycle across `GenerationPanel.tsx:38-46` and `CarouselBuilder.tsx:790-808` through three scenarios: (a) clicking the same "Generate Carousel" link twice without navigating away — the URL doesn't change, so `searchParams` doesn't change identity, so the consuming effect never re-fires (no-op, correct); (b) picking a *different* product while already on the Carousel tab — the `productId` query param changes, `searchParams` changes identity, the effect re-fires with the new id, and `CarouselBuilder`'s own effect (keyed on `[pendingProductId, ...]`, not `[]`) correctly reacts and re-fetches; (c) leaving the page and returning via the Products page a second time — a genuine remount, so `GenerationPanel`'s effect fires fresh on mount regardless of URL history. `CarouselBuilder.tsx:793` calls `setPendingProductId(null)` immediately upon consuming it, so no stale value can be re-consumed. No stale-state issue found in any of the three paths.
- **[BUG]** `components/generate/AdMaker.tsx:214-223` (`fetchRemoteImageAsDataUrl`) does not check `res.ok` before calling `res.blob()`. `fetch()` only rejects on network-level failures (DNS, CORS block); an HTTP-level failure (404, 403 — e.g. a product's `image_urls[0]` pointing at a since-deleted storage object) resolves normally with `res.ok === false`, and the code proceeds straight to `res.blob()`/`FileReader`, "successfully" turning whatever error body came back (often an HTML/JSON error page) into a data URL. That data URL then gets set as `originalPreview` in `handleSelectProduct` (`:452-458`) as if the fetch had genuinely succeeded — the `catch` block's user-facing error message (`"Couldn't load that product's photo..."`) never fires for this class of failure, only for outright network errors. The original commit's stated guarantee ("leave Step 1 untouched on failure") only actually holds for network-level failures, not HTTP-level ones.

---

## 5. My Content Library

- **[BUG]** `app/(dashboard)/brands/[brandId]/library/page.tsx` — `CaptionsTab`'s `selectedIds` (`:1206`) is never reconciled when `platformFilter` or `dateFilter` change (`:1255`, `:1258`). Changing `platformFilter` changes the React Query key (`["library", "captions", brandId, platformFilter]`, `:1128`) and refetches a different server-side set; changing `dateFilter` re-slices the client-side `filtered` array (`:1138` equivalent). Neither path touches `selectedIds`. Concrete scenario: select 3 captions under "All platforms," switch the platform filter to "Instagram" where only 1 of those 3 is still visible — the bulk action bar still reads "3 selected," and confirming "Delete selected" still fires DELETE requests for all 3 ids, including the 2 that are no longer even rendered on screen. Not destructive to data integrity (the deletes still succeed server-side), but a real, confusing UX correctness gap: the visible count and the actual delete set silently diverge.
- **[WORKS AS EXPECTED]** `app/(dashboard)/brands/[brandId]/library/page.tsx:1233-1249` (`handleBulkDelete`) — `Promise.allSettled` results are correctly filtered for `status === "rejected"` to compute `failedCount`, and `bulkDeleteError` is only set (non-null) when `failedCount > 0`. A run where all deletes succeed correctly leaves `bulkDeleteError` as `null` (no message shown); a partial failure correctly surfaces "`N of M` couldn't be deleted." Not a blanket success message regardless of outcome.
- **[WORKS AS EXPECTED]** `lib/utils/carousel-export.ts`'s `downloadCarouselSlidesAsPdf` (dynamic `import("jspdf")`) — verified with an actual `npm run build` (not just `tsc`), per the task's own instruction that a dynamic-import issue might not surface in type-checking alone. The production build completed successfully (`✓ Compiled successfully`, all 86 pages generated, including `/brands/[brandId]/library` and `/dashboard`), with no bundling or resolution error for `jspdf`. `node_modules/jspdf` is present and correctly listed in `package.json`.

---

## 6. Home Dashboard

- **[WORKS AS EXPECTED]** Momentum row Mon–Sun arithmetic (`app/(dashboard)/dashboard/page.tsx`, `startOfWeek`/`momentumDays` construction) — hand-traced both edge cases:
  - **Today = Monday** (`dayOfWeek === 1`): `startOfWeek` = today (offset `1 - 1 = 0`), `endOfWeek` = today + 6 (Sunday). `momentumDays[0]` (Mon) → `dateStr === todayStr` → `isToday: true, isFuture: false`. `momentumDays[1..6]` (Tue–Sun) → all `dateStr > todayStr` → `isFuture: true`. Correct — only today is actionable, the rest of the week shows dashed.
  - **Today = Sunday** (`dayOfWeek === 0`): `startOfWeek` = today − 6 (last Monday), `endOfWeek` = today. `momentumDays[0..5]` (Mon–Sat) are all `dateStr < todayStr` → correctly *not* flagged `isFuture` (they're past, not future) and fall through to the filled/empty branch based on real `count`. `momentumDays[6]` (Sun) → `isToday: true`. No off-by-one in either direction.
  - Also confirmed every non-future day is guaranteed a real entry in `dailyActivityByDate`: the trailing 14-day `dailyActivity` window always fully covers the current week (at most 6 days back), so the `?? 0` fallback in the lookup is only ever exercised for genuine future days, never silently masking a missing past-day entry.
- **[WORKS AS EXPECTED]** `CreditBalancePill` loading-skeleton flash — confirmed `QueryProvider` (`components/providers/QueryProvider.tsx`) is mounted once, at the root `app/layout.tsx`, which Next.js's App Router does not remount on client-side navigation between routes. Its `QueryClient` sets `staleTime: 60 * 1000`. Since `Header.tsx` (rendered on every dashboard page) already calls the same `useUserCredits()` query, the cache is warm by the time a user lands on Home in the normal case — `CreditBalancePill` reads the same cached entry rather than firing a fresh fetch, so its loading skeleton should not flash on a routine navigation back to Home.
- **[MINOR]** Two-card grid (`UpcomingOccasions` + best-hook-type card) — when only one of the two has data, the populated card does not expand to fill the row. `UpcomingOccasions` returns `null` internally when it has no occasions (or the best-hook-type block is conditionally omitted, `{bestHookType && (...)}`) — either way, CSS Grid auto-placement puts the single remaining child into the grid's first track, and `md:grid-cols-2` keeps it locked to 50% width, leaving visible empty space beside it on desktop widths. Neither card conditionally switches to a full-width span when its sibling is absent. Not "an awkward empty box" (no stray border/line renders — the missing sibling contributes no DOM node at all), but does leave dead space next to a single, narrower-than-necessary card.
- **[WORKS AS EXPECTED]** `components/dashboard/CreditGiftBoxes.tsx:51-56` vs `components/layout/Header.tsx:33-36,50,54` — did a line-by-line comparison of the two "low balance" derivations. They are identical variable-for-variable (`userPlan`, `limit`, `generationCount`, `remaining`, `trialing`, and the final boolean expression), just renamed (`showUpgradeNudge` → `showLowBalance`). No copy-paste drift.

---

## Notes on method

- Section 1's database check used a real, read-only Supabase query (service-role client, `SELECT ... LIMIT` only) against the project's own live instance — no writes, no schema changes.
- Section 5's build check ran an actual `next build`, not just `tsc --noEmit`, per the task's own instruction that a dynamic-import bundling issue might not surface in type-checking alone.
- No fixes were applied in this pass. Waiting for confirmation on which findings to act on before making any changes.
