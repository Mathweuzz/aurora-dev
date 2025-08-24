// Tipos e utilidades para projetos e filtros
export type Project = {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  repo?: string;
  homepage?: string;
  featured?: boolean;
  cover?: string;
  updatedAt?: string; // ISO date
};

// Import estático do JSON (build-time)
import projectsRaw from "../data/projects.custom.json";

// Normaliza/ordena: featured > updatedAt desc > name asc
export const PROJECTS: Project[] = (projectsRaw as Project[])
  .map(p => ({
    ...p,
    tags: (p.tags || []).map(t => t.toLowerCase())
  }))
  .sort((a, b) => {
    const fa = a.featured ? 1 : 0;
    const fb = b.featured ? 1 : 0;
    if (fa !== fb) return fb - fa;
    const da = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const db = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (da !== db) return db - da;
    return a.name.localeCompare(b.name);
  });

export function getAllTags(projects = PROJECTS): string[] {
  const set = new Set<string>();
  projects.forEach(p => p.tags?.forEach(t => set.add(t)));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export type FilterOptions = {
  q?: string;
  tags?: string[];
};

export function filterProjects(projects: Project[], opts: FilterOptions): Project[] {
  const q = (opts.q || "").trim().toLowerCase();
  const tags = (opts.tags || []).map(t => t.toLowerCase());

  return projects.filter(p => {
    const textMatch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q);
    const tagMatch =
      tags.length === 0 || (p.tags && tags.every(t => p.tags.includes(t)));
    return textMatch && tagMatch;
  });
}