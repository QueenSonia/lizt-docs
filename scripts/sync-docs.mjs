// Copies lizt-backend/docs/ into src/content/docs/ so Starlight can build it.
// Source: DOCS_SOURCE env var (CI checkout) or ../lizt-backend/docs (local dev).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, process.env.DOCS_SOURCE ?? '../lizt-backend/docs');
const target = path.join(root, 'src/content/docs');

if (!fs.existsSync(source)) {
  console.error(`Docs source not found: ${source}`);
  console.error('Clone lizt-backend next to lizt-docs, or set DOCS_SOURCE.');
  process.exit(1);
}

const toPosix = (p) => p.split(path.sep).join('/');
// Private: any file or folder whose name starts with "_" (_plan.md, _runbook.md…).
const isExcluded = (rel) => rel.split('/').some((segment) => segment.startsWith('_'));

// "product/rules/wallet.md" -> "/product/rules/wallet/"; "index.md" -> "/"
const pageUrl = (rel) => {
  const slug = rel.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '').toLowerCase();
  return slug ? `/${slug}/` : '/';
};

// Authors write relative .md links so they work on GitHub; the site needs page URLs.
const rewriteLinks = (markdown, fileRel) => {
  const parts = markdown.split(/(^```[\s\S]*?^```)/m); // odd indexes are code fences
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(/\]\((?!https?:|mailto:|#|\/)([^)\s]+?\.mdx?)(#[^)\s]*)?\)/g, (match, link, hash = '') => {
        const linked = path.posix.normalize(path.posix.join(path.posix.dirname(fileRel), link));
        if (isExcluded(linked)) console.warn(`  warning: ${fileRel} links to unpublished ${linked}`);
        return `](${pageUrl(linked)}${hash})`;
      });
    })
    .join('');
};

fs.rmSync(target, { recursive: true, force: true });

let copied = 0;
const copyDir = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = toPosix(path.relative(source, abs));
    if (isExcluded(rel)) continue;
    const dest = path.join(target, rel);
    if (entry.isDirectory()) {
      copyDir(abs);
    } else if (/\.mdx?$/.test(entry.name)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, rewriteLinks(fs.readFileSync(abs, 'utf8'), rel));
      copied++;
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(abs, dest); // images and other assets
    }
  }
};
copyDir(source);

console.log(`Synced ${copied} pages from ${source}`);
