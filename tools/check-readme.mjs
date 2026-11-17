#!/usr/bin/env node
// README self-check: bilingual coverage, link integrity, image existence,
// placeholder leftovers, badge presence.
//
//   node check-readme.mjs README.md
//   node check-readme.mjs README.md --no-bilingual
//   node check-readme.mjs README.md --sections "quickstart,license,documentation"
//
// Exit 0 = pass, 1 = at least one hard failure.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) || 'README.md';
const bilingual = !args.includes('--no-bilingual');
const sectionsIdx = args.indexOf('--sections');
const requiredSections = sectionsIdx !== -1 ? (args[sectionsIdx + 1] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

const abs = resolve(file);
if (!existsSync(abs)) {
  console.error(`not found: ${abs}`);
  process.exit(1);
}

const md = readFileSync(abs, 'utf8');
const dir = dirname(abs);
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const LATIN = /[A-Za-z]/;

// Headings must be counted outside fenced code blocks, or `# comment` lines
// inside a bash block look like H1s.
const stripped = md.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');

const results = [];
const record = (level, name, detail = '') => results.push({ level, name, detail });

// ---------------------------------------------------------------- structure
const h1 = [...stripped.matchAll(/^# (.+)$/gm)].map((m) => m[1].trim());
const h2 = [...stripped.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());

if (h1.length === 1) record('ok', 'h1 present', h1[0]);
else record(h1.length === 0 ? 'fail' : 'warn', 'h1 present', `${h1.length} found`);

h2.length >= 4
  ? record('ok', 'sections', `${h2.length} h2`)
  : record('fail', 'sections', `${h2.length} h2 — a README needs at least 4`);

// ---------------------------------------------------------------- bilingual
if (bilingual) {
  const badHeadings = h2.filter((t) => !(CJK.test(t) && LATIN.test(t)));
  badHeadings.length === 0
    ? record('ok', 'bilingual headings', `${h2.length}/${h2.length}`)
    : record('fail', 'bilingual headings', `${badHeadings.length}/${h2.length} missing a language: ${badHeadings.slice(0, 3).join(' | ')}`);

  // body coverage: does the text under each h2 contain Chinese?
  // Sections that are inherently language-neutral (license line, links only)
  // are skipped by length rather than judged as a failure.
  const blocks = stripped.split(/^## /m).slice(1);
  const missingBody = [];
  let judged = 0;
  for (const block of blocks) {
    const [titleLine, ...rest] = block.split('\n');
    const body = rest.join('\n').trim();
    if (body.length < 60) continue; // license line, pure link rows, one-liners
    judged += 1;
    if (!CJK.test(body)) missingBody.push(titleLine.trim());
  }
  const covered = judged - missingBody.length;
  missingBody.length === 0
    ? record('ok', 'bilingual body', `${covered}/${judged} sections`)
    : record('fail', 'bilingual body', `${covered}/${judged} — no Chinese in: ${missingBody.slice(0, 3).join(' | ')}`);

  if (/^\[.*English.*\]\(#/m.test(md) && /^\[.*中文.*\]\(#/m.test(md)) {
    record('warn', 'language switch links', 'found an [English](#…) / [中文](#…) switch — that is the split-halves pattern this style avoids');
  }
}

// ---------------------------------------------------------------- required sections
for (const need of requiredSections) {
  const hit = h2.some((t) => t.toLowerCase().includes(need));
  hit ? record('ok', `section "${need}"`, '') : record('fail', `section "${need}"`, 'missing');
}

// ---------------------------------------------------------------- links
const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
const brokenLinks = [];
let linkCount = 0;
for (const m of md.matchAll(linkRe)) {
  const target = m[1];
  if (/^(https?:|mailto:|#)/.test(target)) continue;
  linkCount += 1;
  const p = target.split('#')[0];
  if (!p) continue;
  const resolved = isAbsolute(p) ? p : resolve(dir, decodeURI(p));
  if (!existsSync(resolved)) brokenLinks.push(target);
}
brokenLinks.length === 0
  ? record('ok', 'relative links', `${linkCount} checked`)
  : record('fail', 'relative links', `${brokenLinks.length} broken: ${brokenLinks.slice(0, 3).join(', ')}`);

// ---------------------------------------------------------------- images
const images = [
  ...[...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]),
  ...[...md.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]),
];
const localImages = images.filter((s) => !/^https?:/.test(s));
const brokenImages = localImages.filter((s) => !existsSync(isAbsolute(s) ? s : resolve(dir, s)));
brokenImages.length === 0
  ? record(localImages.length ? 'ok' : 'warn', 'local images', `${localImages.length} present`)
  : record('fail', 'local images', `missing: ${brokenImages.join(', ')}`);

// ---------------------------------------------------------------- badges
const badges = (md.match(/img\.shields\.io/g) || []).length;
badges >= 3
  ? record('ok', 'badges', `${badges}`)
  : record('warn', 'badges', `${badges} — 3+ is the norm for an OSS README`);

// ---------------------------------------------------------------- placeholders
const placeholders = [...md.matchAll(/\b(TODO|TBD|FIXME|XXX|lorem ipsum)\b/gi)].map((m) => m[1]);
placeholders.length === 0
  ? record('ok', 'no placeholders', '')
  : record('fail', 'no placeholders', `${placeholders.length}: ${[...new Set(placeholders)].join(', ')}`);

// ---------------------------------------------------------------- demo / honesty
const hasImage = images.length > 0;
hasImage ? record('ok', 'demo media', `${images.length} image(s)`) : record('warn', 'demo media', 'no image — a demo or diagram is expected');
const honesty = /not implemented|not yet|known limits|non-goals|但未|尚未|不支持|没做/i.test(md);
honesty ? record('ok', 'limits stated', '') : record('warn', 'limits stated', 'no "what is not implemented" section found');

// ---------------------------------------------------------------- report
const icon = { ok: '✓', warn: '!', fail: '✗' };
console.log(`\nREADME check — ${abs}\n`);
for (const r of results) {
  console.log(`  ${icon[r.level]} ${r.name.padEnd(22)} ${r.detail}`);
}
const fails = results.filter((r) => r.level === 'fail').length;
const warns = results.filter((r) => r.level === 'warn').length;
console.log(`\n${results.length - fails - warns} ok · ${warns} warn · ${fails} fail\n`);
process.exit(fails ? 1 : 0);
