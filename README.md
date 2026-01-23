# Hayai — Fast Boilerplate & API Generator for Bun + Hono + Prisma

Hayai (早い) means "Quick" in Japanese, and that's exactly what it does.
It helps you scaffold a fully functional Hono + Prisma backend in seconds, complete with authentication, role-based guards, and test suites.
Perfect for prototyping MVPs, learning, or setting up clean starting points for side projects.

---

## Why Hayai

Because it's fast — both in name and action.
All letters of its alias `fast` are on your left hand, so even your keyboard agrees.

**Highlights:**

* Generates a complete **Hono + Prisma** project with JWT auth, role-based guards, and test harnesses.
* Builds CRUD modules from `.hayai.json` templates, including controllers, routes, Zod schemas, and test suites.
* Keeps `prisma/schema.prisma` in sync with templates and safely prunes obsolete models.
* Auto-registers generated routes in `src/index.ts` and updates barrel exports.

Hayai can be used through **either command name**: `hayai` **or** `fast`.
Both work identically, because speed is the whole point.

---

## Getting Started
### Using npm

```bash
# install globally with npm
npm i -g @andre_hrs/hayai-cli

# Setting up working directory
mkdir new_project && cd new_project
```

After you are inside the directory you can use the CLI commands

### Using github clone
```bash
# install dependencies
bun install

# (optional) link the CLI locally so `fast` and `hayai` are available
bun link

# Setting up working directory
mkdir new_project && cd new_project

# link the dependency
bun link @andre_hrs/hayai-cli
```
Don't worry about the prefilled package.json. You can safely overwrite it when using the initialization command.

After linking, you can use the CLI in the project with:

```bash
bunx fast <command>
```

or equivalently:

```bash
bunx hayai <command>
```

---

## Core Commands

### `hayai init`

Bootstraps a new Hono API in the current folder:
Copies the starter `src` and `prisma` directories, seeds the default `User` model, and drops a `.env` file if one does not exist.

### `hayai module:add <Name>`

Creates a module template file at `templates/<name>.hayai.json` describing fields, validators, and routes.
Edit the JSON to match your data model.

### `hayai module:build`

Reads all `*.hayai.json` templates and renders:

* Controllers
* Routes
* Zod Schemas
* Tests
* Prisma model updates
  Also updates route registries and exports automatically.

### `hayai module:build <Name>`

Builds a single module if you only need to regenerate one template.

### `hayai module:remove <Name>`

Cleans up all files related to that module — template, generated source files, tests, barrel exports, and Prisma model entries.

> All commands support `--force` (`-f`) to skip confirmation prompts, and `--no-interactive` to disable prompts while keeping safety checks active.

---

## Templates Workflow

1. Run `fast module:add Post` to scaffold `templates/post.hayai.json`.
2. Define your fields, relations, validators, and which CRUD routes to expose.
3. Run `fast module:build` to generate code under `src/controllers`, `src/routes`, `src/schemas`, and `src/tests`.
4. Review the generated Prisma schema updates under `prisma/schema.prisma`.
5. When satisfied, run:

   ```bash
   bun run db:generate
   bun run db:migrate
   ```

---

## Configuration

`.env` from the template are copied automatically when `hayai init` is called.

### Authentication & Users

* `JWT_SECRET` – Secret key for signing JWTs.
* `JWT_EXPIRATION` – Token lifetime (e.g. `7d`).
* `USER_CACHE` – Role cache duration (seconds).
* `SALT_ROUNDS` – Bcrypt salt rounds.

### Database

* `DATABASE_TYPE` – One of `sqlite`, `postgresql`, or `mysql`.
* `DATABASE_URL` – Connection string for the main database.
* `PARALLEL_TEST` – Set to `True` to run generated tests concurrently.
* `TEST_DATABASE_URL` – Connection string used in the test suite.

### Server

* `PORT` – HTTP port for the generated Hono app.
* `NODE_ENV` – Environment (`development`, `production`, etc.).

---

## Next Steps

* Customize your generated modules to match your domain logic.
* Add Prisma migrations after running `hayai module:build`.
* Run the bundled tests with `bun test` to ensure everything works.
* Share your templates with your team or the community — speed loves companionship.

---

### Use It Your Way

Whether you type:

```bash
fast init
```

or

```bash
hayai init
```

Both work the same — because quickness has no preference.
**Hayai is fast. `fast` is Hayai.**

---
## Known Limitations, Please Be Aware
Hayai is designed for speed and clarity, not yet full flexibility or framework-wide abstraction.
It works best for small to medium Hono + Prisma projects but has several intentional trade-offs:
- Stack-specific: Only supports Hono + Prisma; no adapters for other frameworks or ORMs yet.
- User model fixed: The default User module and roles are hard-coded; field customization isn't supported.
- Express habits "oops":
  > So... When I first wrote Hayai, I was still thinking in ExpressJs (the JS not even TS) 
  > terms, controllers, methods, big folders and all. 
  > Not even giving thoughts on type safety until my IDE warns me with "red worms".
  > Only after finishing did I realize I had basically violated [Hono best practices](https://hono.dev/docs/guides/best-practices). 
  > So yes, For now Hayai uses a distributed, controller-based OOP style, not `factory.createHandlers()` approach Hono encourages. 
  > I will try to gradually fix this "oops" moment on my spare time.
- Simplistic templates: Uses marker-based string replacement instead of a full templating engine, so it is very fragile for complex use case. It is basically "generate once, then modify" approach.
- Project mutation risk: Route and export injection relies on string anchors; manual restructuring can break auto-updates.
- Prisma-centric flow: Assumes a Prisma schema; missing or outdated .hayai.json files may prune models unexpectedly.
- Validation limits: Zod schema generation is static; custom validation logic requires manual edits after generation.
- CLI behavior: Defaults to interactive prompts; lacks global config for now.
- Template location: Templates must exist beside the binary or be set via HAYAI_TEMPLATES_ROOT.
- No docs scaffolding: No OpenAPI/Swagger generation yet. Maybe one day, okay?. 

Use Hayai with these trade-offs in mind. 

So if you open the source and think, "Wait, this doesn't align with Hono practices at all?"
Well... Yes, It started that way, from my clumsiness and Express-driven assumptions.

---
Note from the Author
---
> Hayai began as a personal summer break project. Part curiosity with a lot of "let's see if this works."
> Especially around how code generators works like how PHP artisan did the scaffolding for laravel.
> Also learning how to publish my own package in npm.
> I'll maintain it when I can, but semester time might slow updates.
> Feedback, PRs, or memes about my accidental heresy against Hono's best practices are always welcome.
> 
> — Andre