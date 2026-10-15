import type { Job, ProfileFit } from "../types";
import { ACCOUNTING_SYSTEMS, DEFAULT_FIELD_SPEC, normTag, THREE_D_TAG, type FieldDef, type FieldSpec } from "./fields";

/*
 * Profile-fit gate: is this job David's kind of work at all? Deterministic and free, so it runs on every
 * job before the client lookup and the AI. Signals, strongest first: Upwork's skill tags, the title, Upwork's
 * subcategory and category. A bare "AI" in a description never counts ("enemy AI", "AI-powered" sales jobs).
 *
 *   off      - the title names work outside his fields (a "Video Editor", "Sales Rep", an Unreal job) and none
 *              of the skill tags are his; or the tags / Upwork category point outside and nothing points in.
 *              The job is excluded: rank 0, no AI call, no alert, no draft, hidden from the default lists.
 *   core     - a skill tag or the title is clearly one of his fields.
 *   adjacent - no clear signal either way; the AI ranking decides.
 */

interface Hit { field: string; evidence: string }

function tagHit(skills: string[], fields: FieldDef[]): Hit | null {
  const tags = skills.map(normTag);
  for (const f of fields) {
    for (const t of tags) {
      for (const want of f.tags) {
        const ok = want.startsWith("~") ? t.includes(want.slice(1)) : t === want;
        if (ok) return { field: f.label, evidence: t };
      }
    }
  }
  return null;
}

function titleHit(title: string, fields: FieldDef[]): Hit | null {
  for (const f of fields) {
    const m = f.title?.exec(title);
    if (m) return { field: f.label, evidence: m[0] };
  }
  return null;
}

export function assessProfileFit(job: Pick<Job, "title" | "skills" | "category" | "subcategory">, spec: FieldSpec = DEFAULT_FIELD_SPEC): ProfileFit {
  const sub = job.subcategory ?? null;
  const neverTitle0 = titleHit(job.title, spec.never);
  // 3D tags are his work, but they don't make an Unreal/Unity game job his ("Level designer" + "3D Modeling").
  const gameTitle = neverTitle0?.field === "Game development";
  const mineTag = tagHit(gameTitle ? job.skills.filter((t) => !THREE_D_TAG.test(normTag(t))) : job.skills, spec.mine);
  const mineSub: Hit | null = sub && spec.mySubcategories[sub] ? { field: spec.mySubcategories[sub], evidence: `Upwork subcategory ${sub}` } : null;
  const mineTitle = titleHit(job.title, spec.mine) ?? mineSub; // a subcategory counts like a title match
  const neverTitle = neverTitle0;
  const neverTag = tagHit(job.skills, spec.never);
  const offSub = sub ? spec.offSubcategories[sub] ?? null : null;
  const offCategory = (job.category ? spec.offCategories[job.category] : null) ?? offSub;

  const outside = !!(neverTag || offCategory);
  // Building an AI accounting/finance system is his work even with accounting tags or category (8 years of
  // accounting incl. EY); routine bookkeeping or an accountant role is not - when both show, the AI decides.
  if (mineTitle?.field === ACCOUNTING_SYSTEMS && (neverTitle || outside)) {
    return { verdict: "adjacent", field: ACCOUNTING_SYSTEMS, reasons: [`Title names an accounting/finance system ("${mineTitle.evidence}") - the AI decides whether it is a build or an accountant role`] };
  }
  // A role named in the title decides, unless one of his skill tags is there too ("Video Editor" + "AI Video
  // Editing"), or the title also names his work and the tags/category don't confirm the role.
  if (neverTitle && !mineTag && (!mineTitle || outside)) {
    return { verdict: "off", field: neverTitle.field, reasons: [`Title names ${neverTitle.field.toLowerCase()} work: "${neverTitle.evidence}"`, "None of the skill tags are in your fields"] };
  }
  // Tags or Upwork's category point outside his fields, and nothing in the tags or title points in.
  if (outside && !mineTag && !mineTitle) {
    const field = neverTag?.field ?? offCategory!;
    return {
      verdict: "off", field,
      reasons: [neverTag ? `Skill tag "${neverTag.evidence}" is ${field.toLowerCase()} work` : offSub ? `Upwork subcategory "${sub}"` : `Upwork category "${job.category}"`, "Nothing in the title or tags is in your fields"],
    };
  }
  // The title mixes both and the tags are neutral ("AI Video Editor", "Copywriter for Meta ads"): the AI decides.
  if (neverTitle && !mineTag) {
    return { verdict: "adjacent", field: mineTitle!.field, reasons: [`Title mentions "${mineTitle!.evidence}" (${mineTitle!.field}) and "${neverTitle.evidence}" (${neverTitle.field}) - the AI decides`] };
  }
  // The title names the work best ("Cryptocurrency Exchange Platform"); generic tags like "API" come second.
  const mine = mineTitle ?? mineTag;
  if (mine) return { verdict: "core", field: mine.field, reasons: [`${mine.field}: "${mine.evidence}"`] };
  return { verdict: "adjacent", field: null, reasons: ["Nothing clearly in or out of your fields - the AI decides"] };
}
