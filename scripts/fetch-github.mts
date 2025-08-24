/* scripts/fetch-github.mts
 * Busca dados do GitHub (REST + opcional GraphQL) e salva em src/data/github.cache.json.
 * Execução:
 *   pnpm fetch:github -- --user <login> [--limit 60] [--dry-run]
 *   GH_USERNAME=<login> pnpm fetch:github -- --limit 60
 *
 * Env:
 *   - GITHUB_TOKEN ou GH_TOKEN: autenticação opcional (melhor rate limit)
 *   - GH_USERNAME: fallback para o --user
 *   - USE_GRAPHQL=1: tenta buscar "pinned" via GraphQL se houver token
 */

import fs from 'node:fs';
import path from 'node:path';

type Repo = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics?: string[];
  html_url: string;
  homepage: string | null;
  archived: boolean;
  disabled: boolean;
  pushed_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  owner?: { login: string };
  visibility?: string;
};

type Event = {
  id: string;
  type: string;
  created_at: string;
  repo: { name: string; url: string };
  actor?: { login: string; display_login?: string; url?: string };
  payload?: any;
};

type PR = {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url: string;
  repository_url?: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at?: string | null;
  user?: { login: string };
};

type Pinned = {
  name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  primaryLanguage?: string | null;
  url: string;
  homepageUrl?: string | null;
};

type Cache = {
  fetchedAt: string; // ISO
  user: string;
  rate?: { limit?: number; remaining?: number; reset?: number };
  repos: Repo[];
  events: Event[];
  prs: PR[];
  pinned?: Pinned[];
};

const GH_API = 'https://api.github.com';
const GH_GQL = 'https://api.github.com/graphql';

const args = new Map<string, string | true>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const next = process.argv[i + 1];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, true);
    }
  }
}

const username = (args.get('user') as string) || process.env.GH_USERNAME;
if (!username) {
  console.error('❌ Informe o usuário GitHub com --user <login> ou GH_USERNAME=<login>');
  process.exit(1);
}

const limit = Number(args.get('limit') || 60);
const dryRun = Boolean(args.get('dry-run'));

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const useGraphQL = !!token && (process.env.USE_GRAPHQL === '1');

const headers: Record<string, string> = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'aurora-dev-cache/1.0',
  'X-GitHub-Api-Version': '2022-11-28'
};
if (token) headers['Authorization'] = `Bearer ${token}`;

async function ghGet(url: string) {
  const res = await fetch(url, { headers });
  const limit = Number(res.headers.get('x-ratelimit-limit') || '0');
  const rem = Number(res.headers.get('x-ratelimit-remaining') || '0');
  const reset = Number(res.headers.get('x-ratelimit-reset') || '0');
  if (rem <= 0) {
    throw new Error(`Rate limit esgotado. limit=${limit}, remaining=${rem}, reset=${new Date(reset * 1000).toISOString()}`);
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Falha ${res.status} em ${url}: ${txt}`);
  }
  const json = await res.json();
  return { json, rate: { limit, remaining: rem, reset } };
}

async function ghSearchPRs(author: string, perPage = 60) {
  // Search API: PRs autorados pelo usuário (públicos)
  const url = new URL(`${GH_API}/search/issues`);
  url.searchParams.set('q', `author:${author} type:pr is:public`);
  url.searchParams.set('sort', 'updated');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(Math.min(100, perPage)));
  const { json, rate } = await ghGet(url.toString());
  const items = (json.items || []) as any[];
  const mapped: PR[] = items.slice(0, perPage).map((it) => ({
    id: it.id,
    number: it.number,
    title: it.title,
    state: it.state,
    html_url: it.html_url,
    repository_url: it.repository_url,
    created_at: it.created_at,
    updated_at: it.updated_at,
    closed_at: it.closed_at,
    merged_at: it.pull_request?.merged_at || null,
    user: it.user ? { login: it.user.login } : undefined
  }));
  return { prs: mapped, rate };
}

async function fetchPinnedGraphQL(author: string): Promise<{ pinned: Pinned[]; rate?: Cache['rate'] }> {
  if (!useGraphQL) return { pinned: [] };
  const query = `
    query($login: String!) {
      user(login: $login) {
        pinnedItems(first: 6, types: REPOSITORY) {
          nodes {
            ... on Repository {
              name
              description
              stargazerCount
              forkCount
              url
              homepageUrl
              primaryLanguage { name }
            }
          }
        }
      }
      rateLimit { limit remaining resetAt }
    }
  `;
  const res = await fetch(GH_GQL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { login: author } })
  });
  if (!res.ok) {
    const t = await res.text();
    console.warn('⚠️ GraphQL falhou:', t);
    return { pinned: [] };
  }
  const data = await res.json();
  const nodes = data?.data?.user?.pinnedItems?.nodes || [];
  const pinned: Pinned[] = nodes.map((n: any) => ({
    name: n.name,
    description: n.description,
    stargazers_count: n.stargazerCount,
    forks_count: n.forkCount,
    primaryLanguage: n.primaryLanguage?.name || null,
    url: n.url,
    homepageUrl: n.homepageUrl
  }));
  const rl = data?.data?.rateLimit;
  const rate = rl ? { limit: rl.limit, remaining: rl.remaining, reset: rl.resetAt ? Date.parse(rl.resetAt) / 1000 : undefined } : undefined;
  return { pinned, rate };
}

function pickRepo(r: any): Repo {
  return {
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    description: r.description,
    stargazers_count: r.stargazers_count,
    forks_count: r.forks_count,
    language: r.language,
    topics: r.topics,
    html_url: r.html_url,
    homepage: r.homepage,
    archived: r.archived,
    disabled: r.disabled,
    pushed_at: r.pushed_at,
    updated_at: r.updated_at,
    created_at: r.created_at,
    owner: r.owner ? { login: r.owner.login } : undefined,
    visibility: r.visibility
  };
}

function pickEvent(e: any): Event {
  return {
    id: e.id,
    type: e.type,
    created_at: e.created_at,
    repo: { name: e.repo?.name, url: `${GH_API}/repos/${e.repo?.name}` },
    actor: e.actor ? { login: e.actor.login, display_login: e.actor.display_login, url: e.actor.url } : undefined,
    payload: e.payload
  };
}

async function main() {
  console.log(`🔎 Buscando dados GitHub para "${username}" (limit=${limit}, dryRun=${dryRun}, token=${token ? 'yes' : 'no'})`);

  // 1) Verifica usuário (só para feedback)
  const userUrl = `${GH_API}/users/${username}`;
  const u = await ghGet(userUrl);
  console.log(`👤 Usuário: ${u.json.login}, repos públicos: ${u.json.public_repos}, followers: ${u.json.followers}`);

  // 2) Repos
  const reposUrl = new URL(`${GH_API}/users/${username}/repos`);
  reposUrl.searchParams.set('sort', 'updated');
  reposUrl.searchParams.set('per_page', String(Math.min(limit, 100)));
  const reposRes = await ghGet(reposUrl.toString());
  const repos = (reposRes.json as any[]).slice(0, limit).map(pickRepo);

  // 3) Events (públicos)
  const eventsUrl = new URL(`${GH_API}/users/${username}/events/public`);
  eventsUrl.searchParams.set('per_page', String(Math.min(limit, 100)));
  const eventsRes = await ghGet(eventsUrl.toString());
  const events = (eventsRes.json as any[]).slice(0, limit).map(pickEvent);

  // 4) PRs do autor via search
  const { prs, rate: prsRate } = await ghSearchPRs(username, limit);

  // 5) (Opcional) Pinned via GraphQL (se houver token + USE_GRAPHQL=1)
  const { pinned, rate: gqlRate } = await fetchPinnedGraphQL(username);

  // Consolida rate approx
  const rate = reposRes.rate || u.rate || prsRate || gqlRate;

  const cache: Cache = {
    fetchedAt: new Date().toISOString(),
    user: username,
    rate,
    repos,
    events,
    prs,
    pinned
  };

  // Saída
  const outDir = path.join('src', 'data');
  const outFile = path.join(outDir, 'github.cache.json');

  if (dryRun) {
    console.log('🧪 --dry-run: amostra do cache:\n', JSON.stringify({
      ...cache,
      repos: cache.repos.slice(0, 2),
      events: cache.events.slice(0, 2),
      prs: cache.prs.slice(0, 2),
      pinned: cache.pinned?.slice(0, 2) || []
    }, null, 2));
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(cache, null, 2), 'utf-8');
  const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`💾 Gravado: ${outFile} (${kb} kB)`);
  console.log('✅ Concluído.');
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});