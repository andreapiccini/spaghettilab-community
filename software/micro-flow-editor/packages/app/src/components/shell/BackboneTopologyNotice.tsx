import { useEffect, useRef, useState } from "react";
import { useSession } from "../../state/session-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { topologyBoards, topologySignature, topologyCheckpoints, topologyNeedsReconfiguration, withTopologyCheckpoint, initialTopologyCheckpoint } from "../../lib/backbone-topology-change.js";

/** Observe existing discovery snapshots only: no transport requests or Run timers. */
export function BackboneTopologyNotice() {
 const {session, execute, revision, requestDeploy, topologyReviewRequestId} = useSession();
 const {rows,getSnapshot} = useCoreSessions();
 const [review,setReview] = useState(false);
 useEffect(() => { if (topologyReviewRequestId > 0) setReview(true); }, [topologyReviewRequestId]);
 const seenReady = useRef(new Set<string>());
 const project=session?.stack.current;
 const observations = project?.coreBindings.map(binding => {
  const ready=rows.find(row=>row.binding.bindingId===binding.bindingId)?.sessionState==="READY";
  const status=getSnapshot(binding.bindingId)?.status;
  return {bindingId:binding.bindingId,ready,status,boards:topologyBoards(status)};
 }) ?? [];
 const fingerprint=observations.map(item=>`${item.bindingId}:${item.ready}:${topologySignature(item.boards)}`).join(";");
 useEffect(()=>{
  if(!project || !execute)return;
  const timer=setTimeout(()=>{
   for(const item of observations) {
    const checkpoint=topologyCheckpoints(session!.stack.current)[item.bindingId];
    const key=`${project.projectId}:${item.bindingId}`;
    if(item.ready && item.boards.length) {
     seenReady.current.add(key);
     if(!checkpoint || (!checkpoint.pending && topologySignature(checkpoint.boards)!==topologySignature(item.boards))) {
      execute({kind:"ObserveBackboneTopology",apply:current=>({ok:true,value:withTopologyCheckpoint(current,item.bindingId,checkpoint ? {...checkpoint,pending:true,accepted:undefined} : initialTopologyCheckpoint(current,item.bindingId,item.boards))})});
     }
    } else if(checkpoint && !checkpoint.pending && seenReady.current.has(key)) {
     execute({kind:"InvalidateBackboneTopology",apply:current=>({ok:true,value:withTopologyCheckpoint(current,item.bindingId,{...checkpoint,pending:true,accepted:undefined})})});
    }
   }
  },1200);
  return ()=>clearTimeout(timer);
 },[fingerprint,revision,execute,session]);
 if(!project)return null;
 const changed=observations.filter(item=>topologyNeedsReconfiguration(project,item.bindingId,item.status));
 if(!changed.length)return null;
 return <>
  {review && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-5"><section role="dialog" aria-modal="true" aria-label="Riconfigura Backbone" className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-border bg-surface p-6 shadow-xl">
   <h2 className="text-xl font-semibold">Riconfigura Backbone</h2>
   <p className="my-3 text-sm text-ink-muted">Controlla le posizioni: i moduli del progetto verranno preparati sulle nuove schede indicate. Verifica anche il cablaggio. Il caricamento richiede un’ulteriore conferma e lascia il programma fermo.</p>
   {changed.map(item=>{const old=topologyCheckpoints(project)[item.bindingId]?.boards ?? [];return <div key={item.bindingId} className="my-3 rounded-xl border border-border p-3">
    {Array.from({length:Math.max(old.length,item.boards.length)},(_,i)=><div key={i} className="flex flex-wrap justify-between gap-2 border-b border-border py-2 text-sm last:border-0"><strong>Backbone {i+1}</strong><span>{old[i] ? old[i]!.nodeId.toString(16).toUpperCase() : "—"} → {item.ready && item.boards[i] ? `${item.boards[i]!.nodeId.toString(16).toUpperCase()} · ${item.boards[i]!.local ? "USB" : "CAN"}` : "Non connessa"}</span></div>)}
   </div>})}
   <div className="mt-5 flex justify-end gap-3"><button className="rounded-lg border border-border px-4 py-2" onClick={()=>setReview(false)}>Annulla</button><button disabled={changed.some(item=>!item.ready)} className="rounded-lg bg-brand-blue px-4 py-2 text-white disabled:opacity-40" onClick={()=>{
    for(const item of changed)execute?.({kind:"ReviewBackboneTopology",apply:current=>{const checkpoint=topologyCheckpoints(current)[item.bindingId]!;return {ok:true,value:withTopologyCheckpoint(current,item.bindingId,{...checkpoint,pending:true,accepted:topologySignature(item.boards)})};}});
    setReview(false);requestDeploy();
   }}>Conferma disposizione e prepara caricamento</button></div>
  </section></div>}
 </>;
}
