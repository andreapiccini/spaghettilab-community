import { Info } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
export type BlockHelp = { description: string; inputs: readonly string[]; outputs: readonly string[] };
/** Portal keeps the explanation readable at any canvas zoom and outside clipped cards. */
export function BlockInfoButton({ label, help, right = 8 }: { label: string; help?: BlockHelp; right?: number }) {
  const id = useId();
  const [anchor, setAnchor] = useState<{left:number;top:number} | null>(null);
  useEffect(() => {
    const closeOther = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) setAnchor(null); };
    const close = () => setAnchor(null);
    document.addEventListener("block-info-open", closeOther);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("block-info-open", closeOther);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [id]);
  if (!help) return null;
  const show = (element: HTMLElement) => {
    document.dispatchEvent(new CustomEvent("block-info-open", {detail:id}));
    const rect = element.getBoundingClientRect();
    setAnchor({left:Math.max(8,Math.min(rect.right-300,window.innerWidth-308)),top:Math.max(8,Math.min(rect.bottom+8,window.innerHeight-240))});
  };
  return <>
    <button type="button" className="nodrag nopan absolute top-1.5 z-30 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-ink-muted hover:border-brand-blue hover:text-brand-blue focus-visible:outline-2 focus-visible:outline-brand-blue"
      style={{right}} aria-label={`Informazioni su ${label}`} aria-describedby={anchor?id:undefined}
      onMouseEnter={event=>show(event.currentTarget)} onMouseLeave={()=>setAnchor(null)}
      onFocus={event=>show(event.currentTarget)} onBlur={()=>setAnchor(null)}
      onPointerDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()}
      onClick={event=>{event.stopPropagation();show(event.currentTarget);}}
      onKeyDown={event=>{if(event.key==="Escape"){setAnchor(null);event.stopPropagation();}}}>
      <Info size={13} aria-hidden />
    </button>
    {anchor && createPortal(<div id={id} role="tooltip" className="pointer-events-none fixed z-[10000] w-[300px] rounded-xl border border-border bg-surface p-3 font-body text-xs leading-5 text-ink shadow-e2" style={anchor}>
      <p className="mb-1 font-semibold">{label}</p>
      <p className="mb-2">{help.description}</p>
      <p><strong>Ingresso:</strong> {help.inputs.length?help.inputs.join(", "):"Nessuno"}.</p>
      <p><strong>Uscita:</strong> {help.outputs.length?help.outputs.join(", "):"Nessuna"}.</p>
    </div>, document.body)}
  </>;
}
