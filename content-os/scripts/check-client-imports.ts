// CI guard (.github/workflows/ci.yml): fails if any file reachable from a
// "use client" component imports a server-only module -- sharp, fs, path,
// child_process, or lib/image/text-contrast.ts (which loads sharp).
// Bundling one of those into the browser build fails the production
// build; that is what broke every Vercel deploy from c0bd043 to cef3240
// while tsc stayed green. Run: `npx tsx scripts/check-client-imports.ts`.
//
// Imports are read with the TypeScript parser, so comments and type-only
// imports (erased before bundling) never count. Files marked "use server"
// are server actions -- the client only gets a reference to them -- so the
// walk stops there.
import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { dirname, join, relative, resolve } from "path"
import ts from "typescript"

const ROOT = resolve(__dirname, "..")
const SOURCE_DIRS = ["app", "components", "hooks", "lib", "stores"]
const FORBIDDEN_PACKAGES = new Set(["sharp", "fs", "path", "child_process"])
const FORBIDDEN_FILES = new Set([join(ROOT, "lib/image/text-contrast.ts")])
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"]

function listSourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) listSourceFiles(full, out)
    else if (/\.(tsx?|jsx?|mjs)$/.test(name) && !name.endsWith(".d.ts")) out.push(full)
  }
  return out
}

type Parsed = { directive: string | null; imports: string[] }
const cache = new Map<string, Parsed>()

function parse(file: string): Parsed {
  const hit = cache.get(file)
  if (hit) return hit
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  const first = source.statements[0]
  const directive = first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) ? first.expression.text : null
  const imports: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((e) => e.isTypeOnly)))
      if (!typeOnly) imports.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) imports.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]!)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require"
      if (isDynamicImport || isRequire) imports.push((node.arguments[0] as ts.StringLiteralLike).text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const parsed = { directive, imports }
  cache.set(file, parsed)
  return parsed
}

/** A project file for a relative / "@/" specifier, or null for a package. */
function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2))
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec)
  else return null
  for (const candidate of [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => join(base, "index" + e))]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** "fs", "node:fs", "fs/promises", "sharp" -> the forbidden package name, if any. */
function forbiddenPackage(spec: string): string | null {
  const name = spec.replace(/^node:/, "").split("/")[0]!
  return FORBIDDEN_PACKAGES.has(name) ? name : null
}

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/")
const clientEntries = SOURCE_DIRS.flatMap((d) => listSourceFiles(join(ROOT, d))).filter((f) => parse(f).directive === "use client")

// Breadth-first from every client entry, remembering how each file was
// reached so a failure prints the whole import chain.
const parent = new Map<string, string | null>()
const queue: string[] = []
for (const entry of clientEntries) { parent.set(entry, null); queue.push(entry) }
const problems: string[] = []
const chainTo = (file: string) => {
  const chain: string[] = []
  for (let f: string | null | undefined = file; f; f = parent.get(f)) chain.unshift(rel(f))
  return chain.join("\n      -> ")
}

while (queue.length > 0) {
  const file = queue.shift()!
  for (const spec of parse(file).imports) {
    const pkg = forbiddenPackage(spec)
    if (pkg) { problems.push(`imports "${spec}":\n      ${chainTo(file)}`); continue }
    const target = resolveLocal(spec, file)
    if (!target) continue
    if (FORBIDDEN_FILES.has(target)) { problems.push(`imports ${rel(target)} (loads sharp):\n      ${chainTo(file)}`); continue }
    if (parent.has(target) || parse(target).directive === "use server") continue
    parent.set(target, file)
    queue.push(target)
  }
}

console.log(`[check-client-imports] ${clientEntries.length} "use client" files, ${parent.size} files reachable from them`)
if (problems.length > 0) {
  console.error(`[check-client-imports] ${problems.length} server-only import(s) reachable from client code:\n`)
  for (const p of problems) console.error(`  - ${p}\n`)
  console.error(`Fix: import pure helpers from a server-free module (e.g. lib/design/contrast-math.ts), not the server one.`)
  process.exit(1)
}
console.log("[check-client-imports] OK -- no server-only imports reachable from client code")
