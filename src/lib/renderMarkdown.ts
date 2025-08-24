// src/lib/renderMarkdown.ts
// Util opcional. Mantido para futura necessidade de converter strings → HTML.
// No fluxo atual, usamos Astro's Markdown pipeline via Astro.glob().

export async function renderMarkdownString(md: string): Promise<string> {
  // Fallback mínimo: retorna como <pre> para não quebrar build se chamado inadvertidamente.
  // Se quiser uma renderização real via lib (ex.: 'marked'), instale e use aqui.
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre>${escaped}</pre>`;
}