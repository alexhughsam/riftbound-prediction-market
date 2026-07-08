import type { Card } from '../types.js';

/**
 * Generalized grade handling — no per-card rules. A "graded variant" is any
 * slab-kind card whose base name matches the raw card's base name; grades are
 * parsed from the display name with one pattern for all companies.
 */

export interface GradeInfo {
  company: 'PSA' | 'BGS' | 'CGC' | 'SGC';
  grade: number;
}

const GRADE_RE = /\b(PSA|BGS|CGC|SGC)\s*(10|[1-9](?:\.5)?)\b/i;

export function parseGrade(name: string): GradeInfo | null {
  const m = GRADE_RE.exec(name);
  if (!m) return null;
  return { company: m[1].toUpperCase() as GradeInfo['company'], grade: Number(m[2]) };
}

/** Canonical base name: strip grade tokens and parentheticals, normalize. */
export function baseName(name: string): string {
  return name
    .replace(GRADE_RE, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\b(graded|slab)\b/gi, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Words-overlap match between two base names (>=70% of the shorter). */
export function sameBase(a: string, b: string): boolean {
  const wa = baseName(a).split(' ').filter((w) => w.length > 1);
  const wb = new Set(baseName(b).split(' ').filter((w) => w.length > 1));
  if (!wa.length || !wb.size) return false;
  const hits = wa.filter((w) => wb.has(w)).length;
  return hits >= Math.ceil(Math.min(wa.length, wb.size) * 0.7);
}

export function gradedVariantsOf(card: Card, all: Card[]): Card[] {
  if (card.kind === 'slab') return [];
  return all.filter((c) => c.kind === 'slab' && c.id !== card.id && sameBase(c.name, card.name));
}

export function rawCounterpartOf(card: Card, all: Card[]): Card | null {
  if (card.kind !== 'slab') return null;
  return all.find((c) => c.kind !== 'slab' && sameBase(c.name, card.name)) ?? null;
}
