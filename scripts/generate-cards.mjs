#!/usr/bin/env node
/**
 * 生成个人主页 README 用的统计卡片（纯 SVG，零依赖）。
 *
 * 数据来自 GitHub REST API，产出物提交进仓库，由 GitHub 自己托管，
 * 因此不再依赖 github-readme-stats / vercel 之类的第三方实例。
 *
 * 用法：
 *   GITHUB_LOGIN=SkyeBeFreeman GITHUB_TOKEN=xxx node scripts/generate-cards.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const LOGIN = process.env.GITHUB_LOGIN || 'SkyeBeFreeman';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const API = 'https://api.github.com';
const REPO_SAMPLE = Number(process.env.REPO_SAMPLE || 30);
const OUT_FILE = path.resolve('assets/profile.svg');

const W = 800;
const H = 284;

const THEME = {
  bg: '#ffffff',
  border: '#d0d7de',
  divider: '#d8dee4',
  strong: '#1f2328',
  muted: '#656d76',
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

// 常见语言配色，未收录的按名字哈希生成
const LANG_COLORS = {
  Go: '#00ADD8',
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  Rust: '#dea584',
  Shell: '#89e051',
  Makefile: '#427819',
  Dockerfile: '#384d54',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Vue: '#41b883',
  Lua: '#000080',
  PHP: '#4F5D95',
  Ruby: '#701516',
  Kotlin: '#A97BFF',
  Swift: '#F05138',
  HCL: '#844FBA',
  'Jupyter Notebook': '#DA5B0B',
  Markdown: '#083fa1',
  Smarty: '#f0c040',
  'Objective-C': '#438eff',
  PowerShell: '#012456',
  Assembly: '#6E4C13',
  Batchfile: '#C1F12E',
  Groovy: '#4298b8',
  Starlark: '#76d275',
  Perl: '#0298c3',
};

const fmt = (n) => new Intl.NumberFormat('en-US').format(n);
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function colorFor(name) {
  if (LANG_COLORS[name]) return LANG_COLORS[name];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h},55%,52%)`;
}

async function api(url) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': `profile-cards/${LOGIN}`,
    ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if (res.status >= 500 && attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 800));
      continue;
    }
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function listRepos() {
  const repos = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await api(
      `${API}/users/${LOGIN}/repos?per_page=100&page=${page}&sort=pushed&type=owner`,
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter((r) => !r.fork && !r.archived);
}

/**
 * 读取 profile views 计数（komarev 只提供 SVG，从文本节点里取最后一个纯数字）。
 * 拿不到就返回 null，卡片照常渲染，只是不显示这一项。
 */
async function fetchProfileViews() {
  try {
    const res = await fetch(
      `https://komarev.com/ghpvc/?username=${LOGIN}&style=flat`,
      { headers: { 'user-agent': `profile-cards/${LOGIN}` } },
    );
    if (!res.ok) return null;
    const svg = await res.text();
    const numbers = [...svg.matchAll(/<text[^>]*>([\d,]+)<\/text>/g)].map((m) =>
      Number(m[1].replace(/,/g, '')),
    );
    const views = numbers.filter((n) => Number.isFinite(n)).pop();
    return Number.isFinite(views) ? views : null;
  } catch {
    return null;
  }
}

/** 用 search API 取累计 PR / Issue 数（REST 没有直接的计数接口）。 */
async function searchCount(query) {
  try {
    const data = await api(
      `${API}/search/issues?q=${encodeURIComponent(query)}&per_page=1`,
    );
    return typeof data.total_count === 'number' ? data.total_count : null;
  } catch {
    return null;
  }
}

function profileSvg({ displayName, totals, languages, views, since }) {
  const num = (n) => (n == null ? '—' : fmt(n));

  const cells = [
    ['Total Stars', num(totals.stars)],
    ['Total Forks', num(totals.forks)],
    ['Total PRs', num(totals.prs)],
    ['Total Issues', num(totals.issues)],
    ['Public Repos', num(totals.repos)],
    ['Languages', num(totals.languages)],
  ];

  const stats = cells
    .map(([label, value], i) => {
      const x = 24 + (i % 2) * 176;
      const y = 112 + Math.floor(i / 2) * 54;
      return `  <text x="${x}" y="${y}" font-size="12" fill="${THEME.muted}">${label}</text>
  <text x="${x}" y="${y + 24}" font-size="18" font-weight="600" fill="${THEME.strong}">${esc(value)}</text>`;
    })
    .join('\n');

  const top = languages.slice(0, 8);
  const sum = top.reduce((s, l) => s + l.bytes, 0) || 1;

  let offset = 416;
  const segments = top
    .map((l) => {
      const width = (l.bytes / sum) * 360;
      const seg = `    <rect x="${offset.toFixed(1)}" y="90" width="${Math.max(width - 1.2, 0.6).toFixed(1)}" height="12" fill="${l.color}"/>`;
      offset += width;
      return seg;
    })
    .join('\n');

  const legend = top
    .map((l, i) => {
      const x = 416 + (i % 2) * 182;
      const y = 148 + Math.floor(i / 2) * 38;
      const pct = ((l.bytes / sum) * 100).toFixed(1);
      return `  <circle cx="${x + 4}" cy="${y - 4}" r="4" fill="${l.color}"/>
  <text x="${x + 16}" y="${y}" font-size="13" fill="${THEME.strong}">${esc(l.name)}</text>
  <text x="${x + 164}" y="${y}" font-size="12" fill="${THEME.muted}" text-anchor="end">${pct}%</text>`;
    })
    .join('\n');

  const meta = [];
  if (views != null) {
    meta.push(
      `<tspan font-weight="600" fill="${THEME.strong}">${fmt(views)}</tspan><tspan> profile views</tspan>`,
    );
  }
  if (since) meta.push(`<tspan>Since ${since}</tspan>`);
  const metaText = meta.length
    ? `<text x="776" y="36" font-size="12" text-anchor="end" fill="${THEME.muted}">${meta.join(`<tspan fill="${THEME.divider}"> · </tspan>`)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" role="img" aria-label="${esc(displayName)}'s GitHub stats">
  <defs>
    <clipPath id="bar"><rect x="416" y="90" width="360" height="12" rx="6"/></clipPath>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="${THEME.bg}" stroke="${THEME.border}"/>
  <text x="24" y="36" font-size="16" font-weight="600" fill="${THEME.strong}">${esc(displayName)}'s GitHub Stats</text>
  ${metaText}
  <line x1="24" y1="52" x2="776" y2="52" stroke="${THEME.divider}"/>
  <line x1="400" y1="66" x2="400" y2="252" stroke="${THEME.divider}"/>
  <text x="24" y="78" font-size="11" font-weight="600" letter-spacing="0.6" fill="${THEME.muted}">OVERVIEW</text>
  <text x="416" y="78" font-size="11" font-weight="600" letter-spacing="0.6" fill="${THEME.muted}">MOST USED LANGUAGES</text>
  <g clip-path="url(#bar)">
${segments}
  </g>
${stats}
${legend}
</svg>
`;
}

async function main() {
  const user = await api(`${API}/users/${LOGIN}`);
  const repos = await listRepos();

  const totals = {
    stars: repos.reduce((s, r) => s + (r.stargazers_count || 0), 0),
    forks: repos.reduce((s, r) => s + (r.forks_count || 0), 0),
    repos: user.public_repos,
    languages: 0,
  };

  const sampled = [...repos]
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, REPO_SAMPLE);

  const perRepo = await mapLimit(sampled, 6, async (repo) => {
    try {
      return await api(`${API}/repos/${repo.full_name}/languages`);
    } catch {
      return null;
    }
  });

  const bytes = new Map();
  for (const data of perRepo) {
    if (!data) continue;
    for (const [name, value] of Object.entries(data)) {
      bytes.set(name, (bytes.get(name) || 0) + value);
    }
  }

  const languages = [...bytes.entries()]
    .map(([name, value]) => ({ name, bytes: value, color: colorFor(name) }))
    .sort((a, b) => b.bytes - a.bytes);

  totals.languages = languages.length;
  [totals.prs, totals.issues] = await Promise.all([
    searchCount(`author:${LOGIN} type:pr`),
    searchCount(`author:${LOGIN} type:issue`),
  ]);

  const displayName = user.name || user.login;
  const since = user.created_at
    ? new Date(user.created_at).getUTCFullYear()
    : null;
  const views = await fetchProfileViews();

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(
    OUT_FILE,
    profileSvg({ displayName, totals, languages, views, since }),
  );

  console.log(
    `✔ assets/profile.svg  |  repos=${repos.length} stars=${totals.stars} langs=${languages.length} views=${views ?? 'n/a'}`,
  );
  console.log(
    `  top: ${languages
      .slice(0, 5)
      .map((l) => l.name)
      .join(', ')}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
