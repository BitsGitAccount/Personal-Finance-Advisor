# ADR 002 — Database Setup: ORM, Database Engine, and Schema Design

**Status:** Accepted
**Date:** 2026-10-17
**Project:** FinTrack (Personal Finance Advisor)

---

## Context

Phase 2 established the data layer for the application. Every meaningful feature — users, financial goals, investments, and the relationships between them — eventually needs to be stored somewhere and retrieved reliably.

A "data layer" decision involves at least three separate questions:

1. **Which database engine?** SQLite, PostgreSQL, MySQL, MongoDB, and others all have different operational requirements, capabilities, and trade-offs.
2. **How does application code talk to the database?** Raw SQL written by hand, a query builder, or a full ORM (Object-Relational Mapper) like Prisma?
3. **How is the schema structured?** What are the models, their fields, and how are they related?

The constraints for Phase 2 were:

- **Zero-friction local development.** No Docker containers, no external services, no credentials to configure. The database should just work when you clone the repo and run `npm install`.
- **Type safety continuous with Phase 1.** The TypeScript types from the database schema should automatically extend into the application code, so a field that doesn't exist in the database cannot be accessed in TypeScript.
- **Production-plausible.** The choices should not paint the project into a corner. Switching to PostgreSQL for a real deployment should require minimal application code changes.

The commands that produced the Phase 2 setup were:

```bash
npm install -D prisma
npm install @prisma/client
npx prisma init --datasource-provider sqlite
npx prisma migrate dev --name init
```

---

## Decision

### 1. SQLite for local development instead of PostgreSQL or MySQL

PostgreSQL and MySQL are the industry-standard relational databases for production applications. They are full client-server systems: a separate database process runs independently of your application, listens on a network port, requires authentication credentials, and must be installed and started before your application can use it.

For local development, this means either:
- Installing and managing a local PostgreSQL instance (requires system administration)
- Running PostgreSQL in a Docker container (requires Docker to be installed and running)
- Using a hosted database (requires an account, network access, and introduces latency)

SQLite is a fundamentally different kind of database. It is a file-based, embedded database library. The entire database lives in a single file — in this project, `prisma/dev.db`. There is no separate server process. No credentials. No Docker. No network. The database starts when your application starts and is stored wherever the file is.

For a developer setting up this project for the first time, the experience is:
```bash
git clone ...
npm install
npx prisma migrate dev
npm run dev
```
Done. The database exists, the schema is applied, and the app works.

The important point is that Prisma abstracts the database engine from the application code. The entire database configuration lives in one place:

```prisma
// prisma/schema.prisma
datasource db {
  provider = "sqlite"        ← change this to "postgresql" for production
  url      = env("DATABASE_URL")
}
```

Switching to PostgreSQL for production requires changing `"sqlite"` to `"postgresql"`, updating `DATABASE_URL` in the production environment, and running `prisma migrate deploy`. No application code — no routes, no service functions, no components — needs to change. Prisma's query API is identical across database providers.

**What SQLite cannot do (that PostgreSQL can):**
- Handle many simultaneous write connections (SQLite has a single-writer lock)
- Run as a separate server shared by multiple application instances
- Support certain advanced SQL features (native enums, some JSON operators, full-text search extensions)

These limitations don't matter for local development or a single-developer learning project, but they are the reason you switch to PostgreSQL before going to production.

### 2. Prisma as the ORM instead of raw SQL, Drizzle, or Sequelize

An ORM (Object-Relational Mapper) is a library that lets you interact with a relational database using the programming language you already know, rather than writing SQL strings by hand.

Without an ORM, querying the database looks like this:

```typescript
// Raw SQL — no type safety, no autocomplete
const result = await db.query(
  "SELECT id, email, name FROM User WHERE email = ?",
  [email]
);
// result is `any` — TypeScript has no idea what fields came back
const user = result.rows[0];
console.log(user.emal); // typo — TypeScript won't catch this, it crashes at runtime
```

With Prisma, the same query is:

```typescript
const user = await prisma.user.findUnique({
  where: { email },
});
// user is typed as `User | null` — TypeScript knows every field
console.log(user?.emal); // TypeScript error: Property 'emal' does not exist on type 'User'
```

Prisma generates a fully-typed client from your `schema.prisma` file. Every model in the schema becomes a typed object in TypeScript. Every query result is typed. Accessing a field that doesn't exist is a compile-time error, not a runtime crash.

Prisma also includes two additional tools that were relevant to this phase:

- **Prisma Migrate:** Instead of writing `CREATE TABLE` and `ALTER TABLE` SQL statements by hand, you describe your schema in `schema.prisma` and run `prisma migrate dev`. Prisma generates the SQL migration file for you and applies it. The migration files are committed to git, so the schema history is version-controlled alongside the code.
- **Prisma Studio:** A visual database browser. Run `npx prisma studio` to open a web UI where you can view, filter, and edit your database data. Invaluable during development for verifying that data is being written correctly.

**Why not Drizzle ORM?**
Drizzle is a newer, lighter-weight ORM with a more SQL-like API. It has strong type safety and is gaining popularity. At the time of this project, Drizzle's migration tooling was less mature than Prisma's and the ecosystem (documentation, community examples) was smaller. Prisma is the dominant choice in the Next.js ecosystem, and "learning the standard path first" was a deliberate priority. Drizzle is worth evaluating for future projects.

**Why not raw SQL with `better-sqlite3`?**
Full control and zero abstraction overhead, but you write every query by hand, every result is `any` unless you manually annotate it, and you manage schema changes yourself. This is appropriate for experienced developers who need performance-critical queries or advanced SQL features. For a learning project, the overhead of Prisma's tooling pays for itself immediately.

**Why not Sequelize?**
Sequelize is an older, established ORM. It supports TypeScript but was designed in a JavaScript-first era and its TypeScript support is retrofitted rather than native. Its query API is more verbose than Prisma's, and its generated types are less precise.

### 3. UUID primary keys instead of auto-increment integers

Every row in a relational database needs a unique identifier. There are two common approaches:

**Auto-increment integers:** The database assigns 1 to the first row, 2 to the second, and so on. Simple and efficient. But:
- URLs become sequential and guessable: `/goals/1`, `/goals/2`, `/goals/3`. A user can guess that `/goals/4` exists and try to fetch it.
- They don't work well across distributed systems: if two database servers are both inserting rows, which one assigns ID 5?
- They leak information: the ID tells you how many records exist and in what order they were created.

**UUIDs (Universally Unique Identifiers):** A randomly generated 36-character string like `a3f9c2d1-8b5e-4f2a-9c1d-7e3b8a4f1d2e`. They are:
- Unguessable: knowing `/goals/a3f9c2d1-...` gives no information about any other goal
- Globally unique: can be generated by the application, the database, or any server without coordination
- Opaque: don't leak the size or order of your data

In Prisma, UUID primary keys are declared as:

```prisma
id  String  @id @default(uuid())
```

The `@default(uuid())` tells Prisma to generate a UUID automatically when a new row is created. You never set `id` yourself.

The downside: UUIDs are larger (36 characters as a string vs. 4 bytes as an integer) and slightly slower to index. For an application at this scale, the difference is negligible.

### 4. String columns for enum-like fields instead of Prisma enums

Several fields in the schema represent a fixed set of valid values:
- `cityTier`: must be `TIER_1`, `TIER_2`, or `TIER_3`
- `horizon`: represents the investment time horizon (e.g., `SHORT`, `MEDIUM`, `LONG`)
- `status`: represents goal progress (e.g., `ON_TRACK`, `AT_RISK`, `COMPLETED`)
- `category`: represents the type of investment (e.g., `EQUITY`, `DEBT`, `REAL_ESTATE`)

The natural tool for this in relational databases is an `ENUM` column type — a column that only accepts a predefined list of values. PostgreSQL supports native enums. Prisma also supports an `enum` block that generates an `ENUM` column type.

The problem: **SQLite does not have a native ENUM column type.**

If you use a Prisma `enum` in a SQLite-backed project, Prisma silently stores it as a text column — which works, but means the database itself doesn't enforce the constraint. When you later migrate to PostgreSQL, Prisma will try to create a proper `ENUM` type, which may or may not migrate cleanly depending on what data is already in the database.

The solution used here: store all enum-like values as plain `String` columns in the database, and enforce valid values at the TypeScript level using string union types:

```typescript
// In your application code (not in schema.prisma)
type CityTier = "TIER_1" | "TIER_2" | "TIER_3";
type GoalStatus = "ON_TRACK" | "AT_RISK" | "COMPLETED";
type InvestmentCategory = "EQUITY" | "DEBT" | "REAL_ESTATE" | "GOLD";
```

TypeScript's union types enforce at compile time that only valid values are assigned. The database stores a string, which SQLite and PostgreSQL both handle identically. The migration to PostgreSQL is clean. You can later add a database-level `CHECK` constraint if you want enforcement at the database layer too.

### 5. `onDelete: Cascade` on all foreign keys

When one entity owns another — a User owns Goals, a Goal owns GoalAllocations — you need to decide what happens when the parent is deleted.

Without a cascade rule:
- You delete a User.
- Their Goals still exist in the database, now referencing a User that doesn't exist.
- These are "orphan rows" — data that cannot be reached through any valid relationship.
- Depending on your database, the deletion might fail with a foreign key constraint violation, or it might succeed and leave orphaned data.

With `onDelete: Cascade`:
- You delete a User.
- The database automatically deletes all of that user's Goals.
- Deleting those Goals automatically triggers the cascade on GoalAllocation (because GoalAllocation references Goal with its own cascade).
- The entire tree of owned data is cleaned up atomically.

In Prisma, cascade is declared on the relation field:

```prisma
model Goal {
  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

The cascade is enforced by the database engine itself — not by application code. This means you cannot accidentally forget to clean up child records: the cleanup happens regardless of which code path initiated the deletion.

The one scenario where cascade requires thought: if you ever want to archive (soft-delete) a user rather than truly delete them, cascade becomes inconvenient. For this project, true deletion is the intended behavior.

### 6. The `@@unique([goalId, investmentId])` constraint on GoalAllocation

`GoalAllocation` is a **join table** — a table that represents a many-to-many relationship between two other tables (Goal and Investment) plus additional data about that relationship (`allocatedPct`).

The semantic meaning of a `GoalAllocation` row is: "X% of this goal is funded by this investment." It makes no sense to have two rows both saying "Goal A is funded by Investment B" — there is only one allocation percentage between any given goal-investment pair.

Without a unique constraint, this query would silently create duplicate allocations:

```typescript
// Called twice with the same goalId and investmentId
await prisma.goalAllocation.create({ data: { goalId, investmentId, allocatedPct: 50 } });
await prisma.goalAllocation.create({ data: { goalId, investmentId, allocatedPct: 30 } });
// Now there are two GoalAllocation rows for the same pair — a data integrity bug
```

The `@@unique` constraint makes the database reject the second insert with a unique constraint violation error. The application can catch that error and handle it (e.g., update the existing allocation instead of creating a new one).

This is an example of a general principle: **use the database to enforce data invariants, not just application code.** Application code can have bugs, race conditions, or be called from unexpected paths. A database constraint is always enforced.

### 7. The Prisma singleton in `src/lib/prisma.ts`

`PrismaClient` manages a connection pool to the database. Creating a new `PrismaClient()` opens database connections. Creating many of them quickly exhausts the connection limit.

In a standard Node.js server, you would create one `PrismaClient` at startup and reuse it for the lifetime of the process. Next.js development mode complicates this because of **Hot Module Replacement (HMR)**: when you save a file during development, Next.js re-imports that module. If `new PrismaClient()` is at the module level of your database file, every file save creates a new client and opens new connections.

After enough saves, the connection pool fills up and you see errors like:
```
Error: Too many clients already
```

The solution is a singleton pattern using `globalThis`, which is not hot-reloaded:

```typescript
// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

How this works:
1. On the first import, `globalForPrisma.prisma` is `undefined`, so `new PrismaClient()` runs.
2. The new client is stored on `globalThis.prisma`.
3. On the next HMR reload, this module is re-imported. This time, `globalForPrisma.prisma` already exists, so `new PrismaClient()` does not run. The existing client is reused.
4. In production (`NODE_ENV === "production"`), HMR doesn't exist, so we skip step 2. Every import of this module uses the same cached module instance — which is how Node.js modules work normally.

This pattern is the [official Prisma recommendation for Next.js](https://www.prisma.io/docs/guides/other/troubleshooting-orm/help-articles/nextjs-prisma-client-dev-practices).

### 8. `@updatedAt` timestamps on mutable models

Every model that can be modified (User, Goal, Investment) has:

```prisma
updatedAt  DateTime  @updatedAt
```

The `@updatedAt` directive tells Prisma to automatically set this field to the current timestamp whenever a row is updated — for any operation: `update`, `upsert`, or `updateMany`. You never set it manually.

This serves several purposes:
- **Debugging:** You can query `ORDER BY updatedAt DESC` to find recently changed records.
- **Cache invalidation:** A caching layer can compare the `updatedAt` timestamp to determine whether a cached response is stale.
- **Audit trail:** When something goes wrong with a user's data, you can see when each record was last changed.

GoalAllocation does not have an `updatedAt` column because the entire row is deleted and recreated when allocation percentages change, rather than being updated in place.

---

## Schema

The full Prisma schema, with explanations of every field and relationship:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

// ─── User ────────────────────────────────────────────────────────────────────
// A registered user of the application.

model User {
  id            String       @id @default(uuid())
  // UUID primary key — unguessable, globally unique. Generated by Prisma on create.

  email         String       @unique
  // Used for login and identification. @unique creates a database index that
  // enforces no two users can share an email and speeds up lookups by email.

  name          String?
  // Optional display name. The ? makes this nullable — null until the user sets it.

  passwordHash  String
  // Never store passwords in plain text. Store the result of bcrypt(password, salt).
  // This field holds that hash.

  age           Int
  // Used to calculate appropriate investment time horizons and risk tolerance.

  monthlySalary Float
  // Used for financial planning calculations (e.g., SIP affordability, savings rate).

  cityTier      String       @default("TIER_1")
  // Represents the cost-of-living tier of the user's city.
  // Valid values (enforced in TypeScript): "TIER_1" | "TIER_2" | "TIER_3"
  // Stored as String (not enum) for SQLite compatibility. See ADR decision #4.

  createdAt     DateTime     @default(now())
  // Set once on insert. Tells you when the account was created.

  updatedAt     DateTime     @updatedAt
  // Automatically updated by Prisma on every write. Tells you when the record last changed.

  goals         Goal[]
  // Relation: this user's goals. Not a database column — a virtual field
  // that lets you write `prisma.user.findUnique({ include: { goals: true } })`.

  investments   Investment[]
  // Relation: this user's investments. Same pattern as goals.
}

// ─── Goal ─────────────────────────────────────────────────────────────────────
// A financial goal the user is working toward (e.g., "Buy a house by 2030").

model Goal {
  id           String           @id @default(uuid())

  userId       String
  // Foreign key: references User.id. This column is stored in the database.

  user         User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  // The relation definition. Prisma uses this to:
  //   - Know that userId is a FK pointing to User.id
  //   - Apply CASCADE: if the User is deleted, this Goal is deleted too
  //   - Provide the virtual `goal.user` field for includes

  title        String
  // Display name of the goal (e.g., "Emergency Fund", "Retirement", "Child's Education").

  targetAmount Float
  // The rupee amount to reach (e.g., 5000000 for ₹50 lakh).

  targetDate   DateTime
  // When the goal should be achieved. Used to calculate required monthly investment.

  horizon      String
  // Investment time horizon derived from (targetDate - now()).
  // Valid values (enforced in TypeScript): "SHORT" | "MEDIUM" | "LONG"
  // Stored as String for SQLite compatibility.

  status       String           @default("ON_TRACK")
  // Current progress status of the goal.
  // Valid values (enforced in TypeScript): "ON_TRACK" | "AT_RISK" | "COMPLETED" | "PAUSED"

  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  allocations  GoalAllocation[]
  // Relation: the investments allocated to fund this goal.
}

// ─── Investment ───────────────────────────────────────────────────────────────
// A financial instrument the user holds (e.g., a mutual fund, FD, or stock).

model Investment {
  id           String           @id @default(uuid())

  userId       String
  user         User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  title        String
  // Display name (e.g., "Parag Parikh Flexi Cap Fund", "SBI FD").

  category     String
  // Asset class. Valid values: "EQUITY" | "DEBT" | "REAL_ESTATE" | "GOLD" | "CASH"
  // Stored as String for SQLite compatibility.

  currentValue Float
  // The current market value of the investment in rupees.

  monthlySIP   Float            @default(0)
  // Systematic Investment Plan: how much is being invested each month.
  // Zero for lump-sum investments or assets without ongoing contributions.

  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  allocations  GoalAllocation[]
  // Relation: the goals this investment is allocated toward.
}

// ─── GoalAllocation ───────────────────────────────────────────────────────────
// A join table linking a Goal to an Investment with a percentage.
// Answers the question: "What percentage of this investment funds this goal?"
//
// Example: 60% of my Parag Parikh fund is allocated toward my Retirement goal,
//          40% toward my Child's Education goal.

model GoalAllocation {
  id           String     @id @default(uuid())

  goalId       String
  goal         Goal       @relation(fields: [goalId], references: [id], onDelete: Cascade)
  // If the Goal is deleted, all its GoalAllocations are deleted too.

  investmentId String
  investment   Investment @relation(fields: [investmentId], references: [id], onDelete: Cascade)
  // If the Investment is deleted, all its GoalAllocations are deleted too.

  allocatedPct Float
  // The percentage (0–100) of this investment allocated to this goal.
  // Application code is responsible for ensuring allocations per investment sum to 100%.

  @@unique([goalId, investmentId])
  // Compound unique constraint: a specific goal-investment pair can appear only once.
  // Prevents duplicate allocations for the same pair.
}
```

---

## Consequences

### Positive

- **Zero-friction local setup.** `npx prisma migrate dev` creates the SQLite database file. No external services required.
- **End-to-end type safety.** Prisma generates TypeScript types from the schema. A field added or removed in `schema.prisma` immediately surfaces as a compile error everywhere that field is used in application code.
- **Schema changes are version-controlled.** Every `prisma migrate dev --name <description>` creates a SQL file in `prisma/migrations/`. The schema history is in git. Any developer can replay all migrations on a fresh database with `prisma migrate deploy`.
- **Clean cascade behavior.** Deleting a user removes all their data atomically — no orphan rows, no manual cleanup code.
- **Data integrity at the database level.** The compound unique constraint on GoalAllocation means duplicate allocations are impossible regardless of which code path runs.
- **`@updatedAt` is automatic.** You never need to remember to set `updatedAt` when performing an update.

### Negative / Trade-offs

- **Prisma Migrate can be inconvenient during rapid schema iteration.** Every schema change requires running `prisma migrate dev`, which creates a new migration file. Early in development when the schema is changing frequently, you may prefer `prisma db push` (which syncs the schema directly without creating migration files) and then create a proper migration once the schema stabilizes.
- **SQLite has write concurrency limits.** SQLite uses a file-level lock for writes — only one write can happen at a time. For a single-developer local environment this is fine. It is not suitable for a production multi-user application under load.
- **No native enum enforcement in SQLite.** The valid values for `cityTier`, `horizon`, `status`, and `category` are enforced only in TypeScript, not in the database. A raw SQL insert could write any string. If this becomes a concern, add database-level `CHECK` constraints in a migration.
- **Prisma adds build-time code generation.** `prisma generate` must run after `npm install` and after any schema change to update the generated client. This is normally handled automatically by `prisma migrate dev`, but it is an extra step in CI or after pulling schema changes from git. Consider adding `prisma generate` as a `postinstall` script in `package.json`.
- **UUIDs are larger than integers.** String UUIDs (36 characters) take more storage and are slower to index than 4-byte integers. For a learning project or an application with thousands of users this is irrelevant. For a system with billions of rows it would be worth evaluating integer IDs or shorter UUID variants like ULID or nanoid.

---

## Alternatives Considered

| Alternative | Why it was not chosen |
|---|---|
| **PostgreSQL from day one** | Requires a running database server or Docker. Adds setup friction with no benefit during local development on a single-machine project. Switch to PostgreSQL before deploying to production — changing one line in `schema.prisma` is all that's required. |
| **MySQL** | Similar trade-offs to PostgreSQL but with worse support for modern SQL features and a more complex type system. PostgreSQL is the stronger choice when moving off SQLite. |
| **MongoDB + Mongoose** | Document databases store data as JSON-like objects without a fixed schema. This is powerful for unstructured or rapidly changing data, but financial data is inherently relational: goals reference users, allocations reference both goals and investments. Forcing a relational model into documents adds complexity rather than removing it. MongoDB also has no built-in migration system. |
| **Drizzle ORM** | Strong type safety and a SQL-like API. Migration tooling was less mature at the time of this project. Worth evaluating for future projects, especially if you want more direct control over the SQL being generated. |
| **Raw SQL with `better-sqlite3`** | Maximum control and zero abstraction overhead, but every query is written by hand as a string, type safety requires manual annotation, and schema changes are managed manually. Appropriate for experienced developers; adds unnecessary cognitive overhead for a learning project. |
| **Sequelize** | A well-established ORM but with retrofitted TypeScript support. Generates less precise types than Prisma and has a more verbose API. Prisma is the current standard in the Next.js ecosystem. |
| **Auto-increment integer IDs** | Simpler than UUIDs but sequential and guessable in URLs. Also inconvenient if the application ever needs to generate IDs before inserting to the database (e.g., optimistic UI updates). |
| **Prisma enums for status/category fields** | Works correctly on PostgreSQL but requires careful handling for SQLite, and complicates the migration to PostgreSQL. String columns with TypeScript union types provide equivalent compile-time safety with zero database-compatibility concerns. |
