# lizt-docs

The website for the Lizt documentation, built with [Astro Starlight](https://starlight.astro.build).

**This repo holds no documentation content.** Every page comes from [`lizt-backend/docs/`](https://github.com/QueenSonia/Lizt-Backend/tree/main/docs). To add or change a page, edit it in lizt-backend. Anything written in this repo's content folder is deleted on the next sync.

## How the sync works

`scripts/sync-docs.mjs` copies `lizt-backend/docs/` into `src/content/docs/`, which Starlight builds into the site.

- It deletes `src/content/docs/` first, so the site always matches the source exactly.
- It skips `_plan.md` (the private docs plan) and `engineering/runbooks/` (internal only).
- It rewrites relative links such as `../rules/wallet.md` into site URLs such as `/product/rules/wallet/`, so the same links work on GitHub and on the site.
- It reads from `../lizt-backend/docs` by default, or from the `DOCS_SOURCE` environment variable if set (used in CI).

`src/content/docs/` is in `.gitignore`, so synced content is never committed here.

The sidebar has three sections, Product, Engineering and Reference, generated from the folders of the same names. Folders inside them become groups, and each page's `title` frontmatter becomes its sidebar label.

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
