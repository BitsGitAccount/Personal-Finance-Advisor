# ADR 001 — Project Bootstrap: Framework, Language, and Tooling

**Status:** Accepted
**Date:** 2026-10-17
**Project:** FinTrack (Personal Finance Advisor)

---

## Context

Before writing a single line of application code, every project forces you to make a stack of foundational decisions: Which framework? Which language? How will styles work? Where does the code live? These choices are cheap to get right at the start and expensive to undo later, so they deserve careful thought.

The goal of Phase 1 was to bootstrap a full-stack web application that would eventually handle user authentication, financial goals, and investment tracking. The constraints were:

- **Single developer, learning context.** The developer is learning full-stack patterns for the first time. Reducing accidental complexity (two servers, two package.json files, CORS headers, separate deployment pipelines) was a priority.
- **TypeScript from day one.** Financial data involves numbers, user records, and relationships between entities. Type safety would catch mistakes before they reach the database.
- **Modern, production-relevant choices.** The learning project should reflect how real applications are built today, not patterns that have been deprecated or superseded.

The bootstrap command that produced the initial project was:

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
```

Turbopack was enabled when prompted during setup. After scaffolding, the default boilerplate was stripped out: `src/app/page.tsx` was replaced with minimal placeholder content, `src/app/globals.css` was reduced to a single `@import "tailwindcss"` line, and the default SVG files in `public/` were deleted.

---

## Decision

### 1. Next.js 15 instead of a plain React frontend with a separate Express backend

A common beginner setup is to create a React app with Vite (or Create React App) for the frontend and a separate Express or Fastify server for the backend API. This works, but it introduces a significant amount of scaffolding before you can write useful code:

- Two separate projects, each with their own `package.json` and `node_modules`
- Two servers running simultaneously during development (typically on different ports)
- CORS (Cross-Origin Resource Sharing) configuration, because the browser will block requests from one port to another by default unless you explicitly allow them
- Two separate deployment pipelines when you eventually host the app

Next.js collapses all of this. Your React components live in `src/app/`. Your API endpoints live in `src/app/api/`. Both are served by a single Next.js server. In development, `npm run dev` is the only command you need. There is no CORS to configure because the frontend and backend share the same origin.

For a learning project, this means you can focus on learning full-stack patterns — how data flows from the database to the UI — rather than spending time on infrastructure plumbing.

For a production project, Next.js also handles server-side rendering, image optimization, and edge deployment, all of which would require significant additional work in a plain React + Express setup.

### 2. App Router instead of Pages Router

Next.js has two routing systems. The **Pages Router** (the original system, introduced with Next.js) uses a `pages/` directory where each file becomes a URL. The **App Router** (introduced in Next.js 13) uses an `src/app/` directory with a more powerful but different set of conventions.

The key differences that mattered for this project:

- **Server Components by default.** In the App Router, every component is a Server Component unless you opt out with `"use client"` at the top of the file. A Server Component runs only on the server — it can query the database directly, access secrets, and never ships JavaScript to the browser. This matters for performance and security.
- **Nested layouts.** The App Router supports `layout.tsx` files that wrap child pages. A dashboard layout (sidebar, header) defined once in `src/app/dashboard/layout.tsx` automatically wraps every page inside that folder.
- **Colocated route handlers.** API endpoints are `route.ts` files inside the same `app/` folder tree, next to the pages they serve. `src/app/api/goals/route.ts` handles `GET /api/goals` and `POST /api/goals`.

The Pages Router is still supported for backwards compatibility but it is the legacy path. New Next.js features are built for the App Router. Starting a new project on the Pages Router would mean learning an approach that is being phased out.

### 3. TypeScript instead of plain JavaScript

JavaScript is dynamically typed: a variable can hold any value, and the language will not tell you if you try to call `.toUpperCase()` on a number or access `.email` on `undefined`. TypeScript adds a static type system on top of JavaScript. You declare what types your variables, function parameters, and return values should be, and the TypeScript compiler checks those claims before your code runs.

For a full-stack application, this is particularly valuable because the same types can span the entire application:

```typescript
// Defined once, used everywhere
type User = {
  id: string;
  email: string;
  name: string | null;
  monthlySalary: number;
};

// TypeScript will error here if you access user.phoneNumber — it doesn't exist
function formatGreeting(user: User): string {
  return `Hello, ${user.name ?? user.email}`;
}
```

When your Prisma schema (the database definition) generates TypeScript types automatically, the same type safety extends from the database layer through your API routes all the way to your React components. A field renamed in the schema becomes a compile error everywhere it's used — rather than a runtime crash discovered in production.

The learning curve is real: TypeScript requires more upfront thought. But for a project involving financial data — where a bug in a number field or a missing null check could silently corrupt a user's data — the overhead is worth it.

### 4. Tailwind CSS v4 instead of CSS Modules, styled-components, or plain CSS

There are many ways to style a React application:

- **Plain CSS:** Write `.css` files, import them into components. Verbose, and class names across files can collide.
- **CSS Modules:** Each `.module.css` file is scoped to the component that imports it, preventing naming collisions. Requires a separate file per component.
- **styled-components / Emotion:** Write CSS inside JavaScript using tagged template literals. Powerful but adds a runtime cost and complicates server-side rendering.
- **Tailwind CSS:** A utility-first framework. Instead of writing CSS rules, you apply pre-built utility classes directly in your JSX.

With Tailwind, a card component looks like this:

```jsx
<div className="rounded-lg border border-gray-200 p-6 shadow-sm">
  <h2 className="text-xl font-semibold text-gray-900">Monthly Budget</h2>
  <p className="mt-2 text-3xl font-bold text-green-600">₹45,000</p>
</div>
```

The advantages for this project:

- **No context switching.** You write styles and markup in the same file. There is no separate `.css` file to keep synchronized with your component.
- **No naming things.** The cognitive overhead of inventing class names like `.card-header-budget-amount` disappears.
- **Responsive design is built in.** `md:flex-row` means "apply `flex-row` at medium screen widths and above." Responsive breakpoints are part of the class naming convention.
- **Consistent design tokens.** Tailwind's default scale (spacing, font sizes, colors) is thoughtfully designed. Using `p-4` (1rem) and `p-6` (1.5rem) consistently across the app produces visual harmony without a design system.

Tailwind v4 (used here) replaced the `tailwind.config.js` file with a pure CSS configuration. The entire setup is `@import "tailwindcss"` in your global stylesheet — no JavaScript configuration file needed.

### 5. The `src/` directory structure

Without the `--src-dir` flag, Next.js places `app/`, `components/`, and other code directories at the repository root, alongside `package.json`, `next.config.ts`, `tsconfig.json`, and `.env`. This works, but it mixes application code with project configuration.

The `--src-dir` flag moves all application code into a `src/` folder:

```
/                          ← config files live here
  package.json
  next.config.ts
  tsconfig.json
  .env
  src/                     ← all application code lives here
    app/
    components/
    lib/
```

This is a widely-used convention in larger projects. It makes the root directory easier to scan and makes it immediately obvious what is configuration versus what is application code.

### 6. The `@/*` import alias

Without an import alias, importing a component from deep inside your folder tree uses a relative path that describes the file system distance between the importing and imported file:

```typescript
// From src/app/dashboard/goals/page.tsx, importing a component:
import { GoalCard } from "../../../components/goals/GoalCard";
```

If you move either file, every relative path that references it breaks. With the `@/*` alias configured in `tsconfig.json`, `@/` always resolves to the `src/` directory, regardless of where the importing file lives:

```typescript
import { GoalCard } from "@/components/goals/GoalCard";
```

This import works identically from any file in the project. It is easier to read, easier to write, and immune to breakage from file moves.

### 7. Turbopack instead of Webpack

Every time you save a file during development, the bundler needs to reprocess your code and push the change to the browser (Hot Module Replacement, or HMR). In large projects, Webpack — the default bundler — can take several seconds per save. This adds up over a day of development.

Turbopack is Next.js's new bundler, written in Rust. It is architected around incremental computation: when you save a file, it only reprocesses the parts of the dependency graph that changed. The result is dramatically faster HMR — often under 50ms for small changes, compared to several seconds with Webpack on large codebases.

Turbopack is still maturing (some advanced Webpack features are not yet supported), but for a project of this size it is the clearly superior choice for development velocity. It is also the future direction of Next.js.

---

## Consequences

### Positive

- **Single `npm run dev` starts everything.** No separate backend server, no CORS configuration.
- **TypeScript catches bugs at compile time.** Especially valuable as the codebase grows and relationships between types become complex.
- **App Router is the standard.** All Next.js documentation, examples, and future features are written for it.
- **Tailwind accelerates UI work.** Building layouts and components is fast without the overhead of a CSS design system.
- **Clean project structure from day one.** The `src/` directory and `@/*` alias scale well as the project grows.

### Negative / Trade-offs

- **Next.js App Router has a learning curve.** The distinction between Server and Client Components, and understanding when to use each, requires upfront mental investment. The App Router mental model is genuinely different from anything in Pages Router or plain React.
- **TypeScript adds verbosity.** Simple functions require type annotations. The compiler will block you from running code that has type errors, even if you are confident it would work.
- **Tailwind class names become long.** A complex component might have 15-20 classes on a single element. Some developers find this harder to read than a named CSS class. Extracting frequently-used combinations into reusable components (rather than CSS classes) is the Tailwind-idiomatic solution.
- **Turbopack is not 100% feature-complete.** Some Webpack plugins or loaders may not yet be supported. For this project's scope this is not a concern, but it is worth knowing if you add an unusual dependency.

---

## Alternatives Considered

| Alternative | Why it was not chosen |
|---|---|
| **Vite + React** | Pure frontend; requires a separate backend server. More setup and accidental complexity for a full-stack learning project. |
| **Create React App** | Officially deprecated in 2023. No longer maintained. Not a valid starting point for new projects. |
| **Remix** | Similar philosophy to Next.js App Router (server-first, nested routes), but smaller ecosystem, fewer community resources, and less relevant to the broader job market. |
| **Plain CSS** | Verbose. Global namespace collisions are easy to introduce accidentally. Slower to build consistent UI. |
| **CSS Modules** | Scoped styling is good, but requires a separate file per component. Increases file count and context switching. |
| **JavaScript (no TypeScript)** | No type safety across the stack. Errors that TypeScript would catch at compile time become runtime bugs in a JavaScript project. The overhead of TypeScript pays for itself quickly once you have a database schema. |
| **Pages Router** | The legacy Next.js routing system. Still functional but not receiving new features. Starting here means learning patterns that will need to be unlearned. |
