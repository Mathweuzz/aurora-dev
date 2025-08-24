/* scripts/summarize-ai.mts
 * Gera highlights e changelog semanais a partir de src/data/github.cache.json.
 * Preferencialmente usa IA (OpenAI via OPENAI_API_KEY; OpenRouter via OPENROUTER_API_KEY).
 * Fallback “no-AI”: heurísticas com base em eventos/PRs/repos recentes.
 *
 * Uso:
 *   pnpm summarize:ai -- [--week YYYY-WW] [--max-highlights 5] [--dry-run]
 * Env:
 *   - OPENAI_API_KEY (prioritário)  | AI_MODEL (padrão: "gpt-4o-mini")
 *   - OPENROUTER_API_KEY (alternativo) | AI_MODEL (padrão: "openrouter/auto")
 *   - GH_USERNAME (opcional; apenas para compor títulos/linkagem)
 */

import fs from 'node:fs';
import path from 'node:path';

// ===== Utilidades de data/semana (ISO) =====
function isoWeek(d = new Date()) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((+dt - +yearStart) / 86400000 + 1) / 7);
  return { year: dt.getUTCFullYear(), week: weekNo };
}
function fmtWeek(d = new Date()) {
  const { year, week } = isoWeek(d);
  const ww = String(week).padStart(2, '0');
  return `${year}-${ww}`;
}
function parseWeek(arg?: string) {
  if (!arg) return fmtWeek();
  if (/^\d{4}-\d{2}$/.test(arg)) return arg;
  throw new Error(`Formato de --week inválido: "${arg}". Use YYYY-WW (ex.: 2025-34).`);
}
function withinLastDays(iso: string | null | undefined, days = 7): boolean {
  if (!iso) return false;
  const dt = new Date(iso).getTime();
  const now = Date.now();
  return now - dt <= days * 24 * 60 * 60 * 1000;
}

// ===== Tipos do cache =====
type Repo = {
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics?: string[];
  html_url: string;
  homepage: string | null;
  pushed_at: string | null;
  updated_at: string | null;
};
type Event = {
  id: string;
  type: string;
  created_at: string;
  repo: { name: string; url: string };
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
type Cache = {
  fetchedAt: string;
  user: string;
  repos: Repo[];
  events: Event[];
  prs: PR[];
  pinned?: any[];
};

// ===== CLI args =====
const args = new Map<string, string | true>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const nx = process.argv[i + 1];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    if (nx && !nx.startsWith('--')) { args.set(key, nx); i++; }
    else { args.set(key, true); }
  }
}
const weekStr = parseWeek(args.get('week') as string | undefined);
const maxHighlights = Number(args.get('max-highlights') || 5);
const dryRun = Boolean(args.get('dry-run'));

// ===== Leitura do cache =====
const cachePath = path.join('src', 'data', 'github.cache.json');
if (!fs.existsSync(cachePath)) {
  console.error(`❌ Não encontrei ${cachePath}. Rode primeiro: pnpm fetch:github -- --user <seu_user>`);
  process.exit(1);
}
const cache: Cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
const ghUser = process.env.GH_USERNAME || cache.user || 'meu-usuario';

// ===== Preparação dos dados (semana atual) =====
const recentRepos = (cache.repos || [])
  .filter(r => withinLastDays(r.pushed_at, 14) || withinLastDays(r.updated_at, 14))
  .sort((a, b) => (new Date(b.pushed_at || b.updated_at || 0).getTime() - new Date(a.pushed_at || a.updated_at || 0).getTime()))
  .slice(0, 20);

const mergedPRs = (cache.prs || [])
  .filter(pr => pr.merged_at && withinLastDays(pr.merged_at, 14))
  .sort((a, b) => new Date(b.merged_at!).getTime() - new Date(a.merged_at!).getTime())
  .slice(0, 50);

const interestingEvents = (cache.events || [])
  .filter(e => withinLastDays(e.created_at, 14))
  .filter(e => ['PushEvent', 'PullRequestEvent', 'ReleaseEvent', 'IssuesEvent', 'CreateEvent'].includes(e.type))
  .slice(0, 80);

// ===== Heurística de resumo (fallback) =====
function toRepoLink(full: string) {
  return `https://github.com/${full}`;
}
function repoOfPR(pr: PR): string {
  // repository_url vem como "https://api.github.com/repos/owner/name"
  const r = pr.repository_url?.split('/').slice(-2).join('/');
  return r || '';
}

function buildHeuristicHighlights(): string[] {
  const out: string[] = [];
  // 1) PRs merged
  for (const pr of mergedPRs.slice(0, maxHighlights)) {
    const repo = repoOfPR(pr);
    out.push(`- **${pr.title}** — PR **#${pr.number}** merged em [${repo}](${toRepoLink(repo)}). [Ver PR](${pr.html_url}).`);
  }
  // 2) Repos recém atualizados (se sobrar espaço)
  for (const r of recentRepos) {
    if (out.length >= maxHighlights) break;
    out.push(`- **${r.full_name}** — atualizações recentes${r.language ? ` em ${r.language}` : ''}. [Repo](${r.html_url})${r.homepage ? ` · [Site](${r.homepage})` : ''}.`);
  }
  // 3) Releases/Creates (se ainda sobrar)
  if (out.length < Math.max(3, maxHighlights)) {
    const rel = interestingEvents.find(e => e.type === 'ReleaseEvent');
    if (rel) out.push(`- **Release** em [${rel.repo.name}](${toRepoLink(rel.repo.name)}).`);
  }
  return out.slice(0, Math.max(3, maxHighlights));
}

function buildHeuristicChangelog(): string {
  // Agrupa por repo
  const buckets = new Map<string, string[]>();
  function add(repo: string, line: string) {
    const arr = buckets.get(repo) || [];
    arr.push(line);
    buckets.set(repo, arr);
  }
  // PRs merged
  for (const pr of mergedPRs) {
    const repo = repoOfPR(pr);
    add(repo, `- PR **#${pr.number}** merged: ${pr.title} — [link](${pr.html_url})`);
  }
  // Eventos
  for (const e of interestingEvents) {
    const repo = e.repo?.name || 'desconhecido';
    if (e.type === 'PushEvent') add(repo, `- Push (${(e as any).payload?.size ?? 'n'} commit[s])`);
    if (e.type === 'IssuesEvent') add(repo, `- Issue: ${(e as any).payload?.action} — #${(e as any).payload?.issue?.number}`);
    if (e.type === 'CreateEvent') add(repo, `- Create: ${(e as any).payload?.ref_type} ${(e as any).payload?.ref || ''}`);
    if (e.type === 'ReleaseEvent') add(repo, `- Release: ${(e as any).payload?.release?.tag_name || ''}`);
    if (e.type === 'PullRequestEvent') add(repo, `- PR: ${(e as any).payload?.action} — #${(e as any).payload?.number}`);
  }
  // Ordena por nome do repo
  const lines: string[] = [];
  const keys = Array.from(buckets.keys()).sort();
  for (const k of keys) {
    lines.push(`### ${k}`);
    for (const l of buckets.get(k)!) lines.push(l);
    lines.push(''); // quebra
  }
  if (lines.length === 0) {
    lines.push('_Sem mudanças relevantes nesta semana._');
  }
  return lines.join('\n');
}

// ===== IA (OpenAI / OpenRouter) =====
async function aiSummarize(highlightsDraft: string[], changelogDraft: string) {
  // Decide provedor
  const openaiKey = process.env.OPENAI_API_KEY || '';
  const openrouterKey = process.env.OPENROUTER_API_KEY || '';
  const provider = openaiKey ? 'openai' : (openrouterKey ? 'openrouter' : 'none');
  if (provider === 'none') {
    return {
      source: 'heuristic',
      highlights: highlightsDraft,
      changelog: changelogDraft
    };
  }

  const mask = (s: string) => (s ? `${s.slice(0, 4)}…(masked)` : '');
  console.log(`🧠 IA ativada via ${provider.toUpperCase()} (key=${mask(openaiKey || openrouterKey)})`);

  const model = process.env.AI_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : 'openrouter/auto');
  const endpoint = provider === 'openai'
    ? (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions')
    : 'https://openrouter.ai/api/v1/chat/completions';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (provider === 'openai') headers['Authorization'] = `Bearer ${openaiKey}`;
  else headers['Authorization'] = `Bearer ${openrouterKey}`;

  const sys = [
    `Você é uma IA que escreve resumos técnicos curtos e objetivos.`,
    `Tarefa: com base nos dados do GitHub (PRs merged, pushes, releases) gere:`,
    `1) HIGHLIGHTS (3–5 bullets). Cada item: **título curto** + 1 frase objetiva + link.`,
    `2) CHANGELOG (bullets agrupados por repositório).`,
    `TOM: profissional, conciso, sem adjetivos exagerados.`,
    `FORMATO DE SAÍDA ESTRICTO (sem rodeios, sem \`\`\`):`,
    `===HIGHLIGHTS===`,
    `- ...`,
    `- ...`,
    `===CHANGELOG===`,
    `### owner/repo`,
    `- ...`,
    `### owner/another`,
    `- ...`
  ].join('\n');

  const user = [
    `Semana: ${weekStr}. Usuário GitHub: ${ghUser}.`,
    `Amostra de dados (heurística prévia):`,
    `--- HIGHLIGHTS BASE ---`,
    ...highlightsDraft,
    `--- CHANGELOG BASE ---`,
    changelogDraft.slice(0, 4000) // evita prompt gigante
  ].join('\n');

  const body = {
    model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ],
    temperature: 0.3,
    max_tokens: 900
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const t = await res.text();
      console.warn(`⚠️ Falha na chamada de IA (${res.status}): ${t}`);
      return { source: 'heuristic', highlights: highlightsDraft, changelog: changelogDraft };
    }
    const json = await res.json();
    // Compatível com OpenAI/OpenRouter chat completions
    const text =
      json?.choices?.[0]?.message?.content ??
      json?.choices?.[0]?.text ??
      '';
    if (!text) {
      console.warn('⚠️ Resposta de IA vazia; usando heurística.');
      return { source: 'heuristic', highlights: highlightsDraft, changelog: changelogDraft };
    }
    // Parse do formato
    const parts = text.split('===CHANGELOG===');
    const highRaw = parts[0].split('===HIGHLIGHTS===').pop() || '';
    const chgRaw = parts[1] || '';
    const highs = highRaw.split('\n').map(l => l.trim()).filter(l => l.startsWith('- '));
    const chg = chgRaw.trim() || changelogDraft;
    if (highs.length === 0) {
      console.warn('⚠️ IA não retornou bullets válidos; usando heurística para highlights.');
      return { source: 'ai', highlights: highlightsDraft, changelog: chg };
    }
    return { source: 'ai', highlights: highs.slice(0, Math.max(3, maxHighlights)), changelog: chg };
  } catch (err: any) {
    console.warn('⚠️ Erro na chamada de IA:', err?.message || err);
    return { source: 'heuristic', highlights: highlightsDraft, changelog: changelogDraft };
  }
}

// ===== Escrita dos arquivos =====
function ensureDir(p: string) { fs.mkdirSync(p, { recursive: true }); }
function writeFileSafe(p: string, content: string) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, 'utf-8');
}

async function main() {
  console.log(`🗞️  Gerando conteúdo para a semana ${weekStr} (dryRun=${dryRun})`);

  const baseHighlights = buildHeuristicHighlights();
  const baseChangelog = buildHeuristicChangelog();

  const { source, highlights, changelog } = await aiSummarize(baseHighlights, baseChangelog);

  const now = new Date().toISOString();
  const front = (title: string) => [
    '---',
    `title: "${title}"`,
    `week: "${weekStr}"`,
    `generatedAt: "${now}"`,
    `source: "${source}"`,
    `author: "${ghUser}"`,
    '---',
    ''
  ].join('\n');

  const highlightsMD = [
    front(`Destaques — Semana ${weekStr}`),
    ...highlights
  ].join('\n');

  const changelogMD = [
    front(`Changelog — Semana ${weekStr}`),
    changelog
  ].join('\n');

  // Saída
  const hiPath = path.join('src', 'content', 'highlights', `${weekStr}.md`);
  const chPath = path.join('src', 'content', 'changelog', `${weekStr}.md`);

  if (dryRun) {
    console.log('🧪 --dry-run: prévia dos arquivos');
    console.log('--- Highlights ---\n', highlightsMD.slice(0, 1200), '\n...');
    console.log('--- Changelog ---\n', changelogMD.slice(0, 1200), '\n...');
    return;
  }

  writeFileSafe(hiPath, highlightsMD);
  writeFileSafe(chPath, changelogMD);

  const kb = (p: string) => (fs.statSync(p).size / 1024).toFixed(1);
  console.log(`💾 Gravado: ${hiPath} (${kb(hiPath)} kB)`);
  console.log(`💾 Gravado: ${chPath} (${kb(chPath)} kB)`);
  console.log('✅ Concluído.');
}

main().catch(e => {
  console.error('❌ Erro:', e?.message || e);
  process.exit(1);
});