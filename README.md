# lizt-docs

The website for the Lizt documentation, built with [Astro Starlight](https://starlight.astro.build).

**This repo holds no documentation content.** Every page comes from [`lizt-backend/docs/`](https://github.com/QueenSonia/Lizt-Backend/tree/main/docs). To add or change a page, edit it in lizt-backend. Anything written in this repo's content folder is deleted on the next sync.

## How the sync works

`scripts/sync-docs.mjs` copies `lizt-backend/docs/` into `src/content/docs/`, which Starlight builds into the site.

- It deletes `src/content/docs/` first, so the site always matches the source exactly.
- It skips anything whose name starts with `_`, such as `_plan.md` (the private docs plan) and each feature's `_runbook.md` (internal only).
- It rewrites relative links such as `../renewals/product.md` into site URLs such as `/features/renewals/product/`, so the same links work on GitHub and on the site.
- It reads from `../lizt-backend/docs` by default, or from the `DOCS_SOURCE` environment variable if set (used in CI).

`src/content/docs/` is in `.gitignore`, so synced content is never committed here.

Docs are organised by feature: `features/<feature>/` holds `product.md`, `engineering.md` and sometimes `support.md`. The sidebar has four sections:

- **Start here** — `glossary.md` and `roles.md`.
- **Features** — one group per folder in `features/`, labelled from the folder name (`payment-plans` becomes "Payment plans"). `astro.config.mjs` builds these groups from the synced content. Pages inside a group use their `sidebar.label` and `sidebar.order` frontmatter.
- **Engineering** — `architecture.md` and the `decisions/` folder.
- **Reference** — the `reference/` folder.

## Preview locally

Clone lizt-backend and lizt-docs into the same parent folder:

```
some-folder/
  lizt-backend/
  lizt-docs/
```

Then, in `lizt-docs`:

```sh
npm install
npm run dev
```

`npm run dev` syncs the docs and starts the dev server at http://localhost:4321. It doesn't watch lizt-backend: after editing a page there, stop the server and run `npm run dev` again.

To use a different source folder: `DOCS_SOURCE=/path/to/docs npm run dev`.

Other scripts:

- `npm run sync` — copy the docs only.
- `npm run build` — build the site into `dist/` (run `npm run sync` first).
- `npm run preview` — serve the built site.
- `npm test` — test the login gate.

## Login gate

Only signed-in Lizt accounts with an allowed role can read the deployed site. `middleware.js` runs on Vercel before every request, including assets and the search index. It doesn't run under `npm run dev`, so local previews stay open.

1. With no valid `docs_session` cookie, a page load redirects to `/docs-access` on the Lizt app, carrying the hash of a random secret. The secret stays here in a short-lived cookie. A background request gets a 401 instead.
2. The app checks the session with the backend, then the role. The allowed roles are in `lizt-frontend/src/app/docs-access/route.ts`, the only place to change them.
3. The app redirects to `/__auth/callback` with a signed pass that lasts 60 seconds and contains the hash.
4. The middleware checks the signature, the expiry and that the hash matches this browser's secret, so a pass copied from a URL doesn't work elsewhere. It then sets `docs_session` for 24 hours.

The cookie is never rechecked with the app, so someone who loses their role or signs out keeps access until it expires. To lock everyone out now, change `DOCS_ACCESS_SECRET` in both Vercel projects.

Environment variables, set in each project's Vercel settings:

| Project | Variable | Value |
| --- | --- | --- |
| lizt-docs | `DOCS_ACCESS_SECRET` | A long random string, the same in both projects |
| lizt-docs | `LIZT_APP_URL` | The Lizt app's address, such as `https://www.lizt.co` |
| lizt-frontend | `DOCS_ACCESS_SECRET` | The same string |
| lizt-frontend | `DOCS_SITE_URL` | This site's address |

If they're missing, the site stays locked and shows an error rather than opening.

## Writing pages (in lizt-backend)

- Every page needs frontmatter with a `title` and a `description`, or the build fails:

  ```md
  ---
  title: Rent reminders
  description: When Lizt reminds tenants that rent is due.
  ---
  ```

- Use lowercase kebab-case file names. They become URLs.
- Draw diagrams with ` ```mermaid ` code blocks.
- Search is built in and covers every published page.

## Deployment

`.github/workflows/deploy.yml` builds and deploys the site to Vercel. It runs when:

- lizt-backend pushes a change under `docs/` to main (lizt-backend sends a `docs-updated` event),
- someone pushes to main in this repo, or
- someone runs it by hand from the Actions tab.

It checks out only `docs/` from lizt-backend's main branch, using a read-only deploy key, then syncs, builds and deploys with the Vercel CLI. Vercel's own Git deployments are turned off in `vercel.json`, because Vercel can't reach lizt-backend to fetch the content.

Secrets used: `BACKEND_DEPLOY_KEY`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
