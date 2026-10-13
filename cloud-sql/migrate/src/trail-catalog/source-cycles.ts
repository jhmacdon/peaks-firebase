import { CandidateRejection } from "./graph";

/** Enumerate exact simple cycles. Bridges and trees never enter the cycle search. */
export function sourceCycles(adjacent:Map<string,Set<string>>):string[][] {
  const order=new Map<string,number>(),low=new Map<string,number>(),edgeStack:[string,string][]=[];
  const blocks:[string,string][][]=[];
  let clock=0;
  type Frame={id:string;parent?:string;next:number;neighbors:string[]};
  for (const root of [...adjacent.keys()].sort()) {
    if (order.has(root)) continue;
    order.set(root,++clock);low.set(root,clock);
    const stack:Frame[]=[{id:root,next:0,neighbors:[...(adjacent.get(root)??[])].sort()}];
    while (stack.length) {
      const frame=stack[stack.length-1];
      if (frame.next<frame.neighbors.length) {
        const next=frame.neighbors[frame.next++];
        if (next===frame.parent) continue;
        if (!order.has(next)) {
          edgeStack.push([frame.id,next]);order.set(next,++clock);low.set(next,clock);
          stack.push({id:next,parent:frame.id,next:0,neighbors:[...(adjacent.get(next)??[])].sort()});
        } else if (order.get(next)!<order.get(frame.id)!) {
          edgeStack.push([frame.id,next]);low.set(frame.id,Math.min(low.get(frame.id)!,order.get(next)!));
        }
        continue;
      }
      stack.pop();
      if (!frame.parent) continue;
      low.set(frame.parent,Math.min(low.get(frame.parent)!,low.get(frame.id)!));
      if (low.get(frame.id)!>=order.get(frame.parent)!) {
        const block:[string,string][]=[];
        let edge:[string,string];
        do {edge=edgeStack.pop()!;block.push(edge);} while (edge[0]!==frame.parent || edge[1]!==frame.id);
        if (block.length>=3) blocks.push(block);
      }
    }
  }
  const cycles:string[][]=[];
  let work=0,totalVertices=0;
  const tick=()=>{if (++work>200_000) throw new CandidateRejection("discovery_cycle_search_limit");};
  const save=(cycle:string[])=>{
    totalVertices+=cycle.length;
    if (cycles.length>=500 || totalVertices>200_000) throw new CandidateRejection("discovery_cycle_inventory_limit");
    cycles.push(cycle);
  };
  for (const block of blocks) {
    const graph=new Map<string,Set<string>>();
    for (const [a,b] of block) {
      graph.set(a,new Set([...(graph.get(a)??[]),b]));graph.set(b,new Set([...(graph.get(b)??[]),a]));
    }
    const roots=[...graph.keys()].sort();
    if ([...graph.values()].every(neighbors=>neighbors.size===2)) {
      const root=roots[0],cycle=[root];let previous="",cursor=root;
      do {
        tick();const next=[...graph.get(cursor)!].filter(id=>id!==previous).sort()[0];
        cycle.push(next);previous=cursor;cursor=next;
      } while (cursor!==root);
      save(cycle);continue;
    }
    // Each simple cycle has one least vertex and one canonical direction.
    for (const root of roots) {
      const path=[root],seen=new Set(path),stack:Frame[]=[{id:root,next:0,neighbors:[...graph.get(root)!].sort()}];
      while (stack.length) {
        const frame=stack[stack.length-1];
        if (frame.next===frame.neighbors.length) {stack.pop();seen.delete(path.pop()!);continue;}
        tick();const next=frame.neighbors[frame.next++];
        if (next===root && path.length>=3 && path[1]<path[path.length-1]) {save([...path,root]);continue;}
        if (next<root || seen.has(next)) continue;
        seen.add(next);path.push(next);stack.push({id:next,next:0,neighbors:[...graph.get(next)!].sort()});
      }
    }
  }
  return cycles.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
