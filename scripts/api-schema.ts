/*
 * Dump the official Upwork GraphQL schema (introspection) through the gateway, once the API key works:
 *   npm run api:schema
 * Writes docs/upwork-graphql-schema.json and prints the fields of marketplaceJobPosting and every mutation whose
 * name mentions "proposal", so JOB_DETAILS (lib/upwork/queries.ts) and an API submit can be checked against the
 * real schema instead of guessed. One Upwork call, counted by the pacing governor.
 */
import { writeFileSync } from "node:fs";
import { gql } from "@/lib/upwork/graphql";

const INTROSPECT = `query schema { __schema { queryType { name } mutationType { name }
  types { name kind fields { name args { name type { name kind ofType { name kind ofType { name kind } } } } type { name kind ofType { name kind ofType { name kind } } } } inputFields { name type { name kind ofType { name kind } } } } } }`;

type T = { name: string; kind: string; fields?: { name: string; type: { name: string | null; ofType?: { name: string | null } | null } }[] | null };

async function main() {
  const d = await gql<{ __schema: { queryType: { name: string }; mutationType: { name: string } | null; types: T[] } }>(INTROSPECT, {}, { label: "api.schema" });
  writeFileSync("docs/upwork-graphql-schema.json", JSON.stringify(d.__schema, null, 1));
  const byName = new Map(d.__schema.types.map((t) => [t.name, t]));
  const typeName = (t: { name: string | null; ofType?: { name: string | null } | null }) => t.name ?? t.ofType?.name ?? "?";
  const q = byName.get(d.__schema.queryType.name)?.fields?.find((f) => f.name === "marketplaceJobPosting");
  console.log(`marketplaceJobPosting → ${q ? typeName(q.type) : "NOT FOUND"}`);
  if (q) console.log((byName.get(typeName(q.type))?.fields ?? []).map((f) => `  ${f.name}: ${typeName(f.type)}`).join("\n"));
  const m = d.__schema.mutationType ? byName.get(d.__schema.mutationType.name)?.fields ?? [] : [];
  console.log("mutations mentioning proposal:\n" + m.filter((f) => /proposal/i.test(f.name)).map((f) => `  ${f.name}: ${typeName(f.type)}`).join("\n"));
  console.log("saved docs/upwork-graphql-schema.json");
}

main().then(() => process.exit(0), (e) => { console.error(`ERROR ${(e as Error).message}`); process.exit(1); });
