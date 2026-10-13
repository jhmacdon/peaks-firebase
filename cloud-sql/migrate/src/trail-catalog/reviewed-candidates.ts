import { osmRouteHaversineMeters } from "../osm-route-geometry";
import type { BuiltCandidate } from "./types";

export interface CandidateNamingContext {
  /** Complete reviewed inventories, not just the current batch. */
  completeRegionKeys?: string[];
  completeObjectiveIds?: string[];
  existingRoutes?: { name: string; trailheadId: string; objectiveId: string | null; countryCode: string | null; stateCode: string | null }[];
}
export interface CandidateChoiceRejection {
  sourceKey: string;
  reason: "duplicate_trailhead_objective" | "strict_prefix_without_common_destination_attestation";
  keptSourceKey: string;
}
export interface CandidateNameDecision {
  sourceKey: string;
  name: string;
  aliases: string[];
  namingReason: string;
  commonDestinationEvidence: "absent" | "valid" | "invalid";
}
const normalize = (name: string) => name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
const compare = (a: string,b: string) => a < b ? -1 : a > b ? 1 : 0;
export const catalogNamingRegionKey = (countryCode: string | null,stateCode: string | null) => `${countryCode ?? ""}:${stateCode ?? ""}`;

function evidenceStatus(candidate: BuiltCandidate): CandidateNameDecision["commonDestinationEvidence"] {
  const evidence=candidate.input.commonDestinationEvidence;
  if (!evidence) return "absent";
  try {
    const url=new URL(evidence.sourceUrl);
    const host={usfs:"fs.usda.gov",nps:"nps.gov",wta:"wta.org",alltrails:"alltrails.com"}[evidence.publisher];
    return candidate.objective && evidence.objectiveId===candidate.objective.id
      && evidence.attestation==="standalone_named_hike" && Boolean(evidence.name?.trim())
      && Boolean(evidence.note?.trim()) && Number.isFinite(Date.parse(evidence.checkedAt))
      && url.protocol==="https:" && !url.username && !url.password
      && Boolean(host) && (url.hostname===host || url.hostname.endsWith(`.${host}`)) ? "valid" : "invalid";
  } catch { return "invalid"; }
}
function isMailboxVariant(candidate: BuiltCandidate): boolean {
  return normalize(candidate.objective?.name ?? "")==="mailbox peak"
    && candidate.input.source.type==="osm"
    && ((candidate.input.variant==="mailbox-old" && candidate.input.source.relationId===7147738)
      || (candidate.input.variant==="mailbox-new" && candidate.input.source.relationId===5426108));
}
/** Exact directed vertices only: a shared branch, suffix or reverse is not a prefix. */
export function isStrictCandidatePrefix(shorter: BuiltCandidate,longer: BuiltCandidate): boolean {
  return shorter.trailhead.id===longer.trailhead.id
    && shorter.points.length>=2 && shorter.points.length<longer.points.length
    && shorter.points.every((point,index)=>point.lat===longer.points[index].lat && point.lng===longer.points[index].lng);
}
function seenNames(candidate: BuiltCandidate): string[] {
  return [candidate.input.name,...(candidate.input.aliases??[]),...(candidate.attestedRouteNames??[]),
    ...(candidate.input.identity ? [candidate.input.identity.name] : []),...candidate.edges.flatMap(edge=>edge.names)];
}
function uniqueNames(names: string[],displayName: string): string[] {
  const byName=new Map<string,string>();
  for (const value of names.map(name=>name.trim().replace(/\s+/g," ")).filter(Boolean).sort(compare)) {
    const key=normalize(value);
    if (key && key!==normalize(displayName) && !byName.has(key)) byName.set(key,value);
  }
  return [...byName.values()].sort((a,b)=>compare(normalize(a),normalize(b))||compare(a,b));
}
function primaryTrailName(candidate: BuiltCandidate): string {
  const scores=new Map<string,{name:string;length:number}>();
  candidate.edges.forEach((edge,index)=>{
    // A trail number stays searchable as an alias but is not a display name.
    const name=edge.names.find(value=>/[\p{L}]/u.test(value))?.trim();
    if (!name) return;
    const key=normalize(name), prior=scores.get(key);
    const length=osmRouteHaversineMeters(candidate.points[index],candidate.points[index+1]);
    scores.set(key,{name:prior && compare(prior.name,name)<0 ? prior.name : name,length:(prior?.length??0)+length});
  });
  return [...scores.values()].sort((a,b)=>b.length-a.length||compare(normalize(a.name),normalize(b.name))||compare(a.name,b.name))[0]?.name
    ?? candidate.trailhead.name;
}

/** Pure selection over already source-built candidates; it never reads or writes a catalog. */
export function chooseCatalogCandidates(candidates: BuiltCandidate[],context: CandidateNamingContext = {}): {
  kept: BuiltCandidate[]; rejected: CandidateChoiceRejection[]; names: CandidateNameDecision[];
} {
  const ordered=[...candidates].sort((a,b)=>compare(a.input.sourceKey,b.input.sourceKey));
  if (new Set(ordered.map(candidate=>candidate.input.sourceKey)).size!==ordered.length) throw new Error("duplicate_candidate_source_key");
  const groups=new Map<string,BuiltCandidate[]>();
  for (const candidate of ordered) {
    const key=JSON.stringify([candidate.trailhead.id,candidate.objective?.id??null]);
    groups.set(key,[...(groups.get(key)??[]),candidate]);
  }
  const pairWinners:BuiltCandidate[]=[], rejected:CandidateChoiceRejection[]=[];
  const duplicateAliases=new Map<string,string[]>();
  for (const group of groups.values()) {
    const variants=group.filter(isMailboxVariant), winners:BuiltCandidate[]=[];
    if (variants.length) {
      for (const variant of ["mailbox-old","mailbox-new"]) {
        const winner=variants.find(candidate=>candidate.input.variant===variant);
        if (winner) winners.push(winner);
      }
    } else winners.push(group[0]);
    pairWinners.push(...winners);
    for (const candidate of group.filter(candidate=>!winners.includes(candidate))) {
      const keeper=winners.find(winner=>winner.input.variant===candidate.input.variant)??winners[0];
      rejected.push({sourceKey:candidate.input.sourceKey,reason:"duplicate_trailhead_objective",keptSourceKey:keeper.input.sourceKey});
      duplicateAliases.set(keeper.input.sourceKey,[...(duplicateAliases.get(keeper.input.sourceKey)??[]),...seenNames(candidate)]);
    }
  }
  const retained:BuiltCandidate[]=[];
  for (const candidate of pairWinners.sort((a,b)=>b.points.length-a.points.length||compare(a.input.sourceKey,b.input.sourceKey))) {
    const containing=retained.find(longer=>isStrictCandidatePrefix(candidate,longer));
    if (containing && !isMailboxVariant(candidate) && evidenceStatus(candidate)!=="valid") {
      rejected.push({sourceKey:candidate.input.sourceKey,reason:"strict_prefix_without_common_destination_attestation",keptSourceKey:containing.input.sourceKey});
    } else retained.push(candidate);
  }
  // A duplicate's chosen keeper may itself be a prefix. Report the final keeper.
  const byRejected=new Map(rejected.map(row=>[row.sourceKey,row]));
  for (const row of rejected) while (byRejected.has(row.keptSourceKey)) row.keptSourceKey=byRejected.get(row.keptSourceKey)!.keptSourceKey;
  const names:CandidateNameDecision[]=[], kept:BuiltCandidate[]=[];
  for (const candidate of retained.sort((a,b)=>compare(a.input.sourceKey,b.input.sourceKey))) {
    const region=catalogNamingRegionKey(candidate.trailhead.countryCode,candidate.trailhead.stateCode);
    const objectiveId=candidate.objective?.id;
    const heads=new Set([...retained.filter(other=>other.objective?.id===objectiveId).map(other=>other.trailhead.id),
      ...(context.existingRoutes??[]).filter(other=>other.objectiveId===objectiveId).map(other=>other.trailheadId)]);
    const attested=(candidate.attestedRouteNames??[]).some(name=>normalize(name)===normalize(candidate.input.name));
    let name=candidate.input.name.trim(), namingReason=attested ? "attested_common_name" : "reviewed_loop_or_traverse_name";
    if (isMailboxVariant(candidate)) {
      name=candidate.input.variant==="mailbox-old" ? "Mailbox Peak (old trail)" : "Mailbox Peak (new trail)";
      namingReason="explicit_mailbox_variant";
    } else if (candidate.objective && candidate.input.kind!=="traverse" && (!attested || heads.size>1)) {
      const trailName=primaryTrailName(candidate);
      const baseName=`${candidate.objective.name} via ${trailName}`;
      const sameTrailOtherHead=retained.some(other=>other.objective?.id===objectiveId && other.trailhead.id!==candidate.trailhead.id
        && normalize(primaryTrailName(other))===normalize(trailName))
        || (context.existingRoutes??[]).some(other=>other.objectiveId===objectiveId && other.trailheadId!==candidate.trailhead.id
          && catalogNamingRegionKey(other.countryCode,other.stateCode)===region && normalize(other.name)===normalize(baseName));
      name=`${baseName}${sameTrailOtherHead ? ` (${candidate.trailhead.name})` : ""}`;
      namingReason=heads.size>1 ? "distinct_trailhead_approach" : "objective_via_source_trail";
      const complete=context.completeRegionKeys?.includes(region) && context.completeObjectiveIds?.includes(objectiveId!);
      const nameUsed=retained.some(other=>other.input.sourceKey!==candidate.input.sourceKey
        && catalogNamingRegionKey(other.trailhead.countryCode,other.trailhead.stateCode)===region
        && (normalize(other.input.name)===normalize(candidate.objective!.name) || normalize(other.objective?.name??"")===normalize(candidate.objective!.name)))
        || (context.existingRoutes??[]).some(other=>catalogNamingRegionKey(other.countryCode,other.stateCode)===region && normalize(other.name)===normalize(candidate.objective!.name));
      if (complete && heads.size===1 && !nameUsed) {name=candidate.objective.name;namingReason="unique_objective_single_trailhead_in_reviewed_region";}
    }
    const aliases=uniqueNames([...seenNames(candidate),...(duplicateAliases.get(candidate.input.sourceKey)??[])],name);
    names.push({sourceKey:candidate.input.sourceKey,name,aliases,namingReason,commonDestinationEvidence:evidenceStatus(candidate)});
    kept.push({...candidate,input:{...candidate.input,name,aliases}});
  }
  return {kept,rejected:rejected.sort((a,b)=>compare(a.sourceKey,b.sourceKey)),names};
}
