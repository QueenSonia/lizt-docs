// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

export default defineConfig({
  integrations: [
    // Must come before starlight so it sees ```mermaid blocks first.
    mermaid({ autoTheme: true }),
    starlight({
      title: 'Lizt Docs',
      // Search (Pagefind) is built into Starlight and on by default.
      sidebar: [
        { label: 'Product', items: [{ autogenerate: { directory: 'product' } }] },
        { label: 'Engineering', items: [{ autogenerate: { directory: 'engineering' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
      ],
    }),
  ],
});
