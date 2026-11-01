import { decisionChecks } from '../decision-model';
import { dt } from '../api';
import { Icon, toast } from '../ui';

export default function ReviewReadiness({ detail, openTab }: { detail:any; openTab:(tab:string)=>void }) {
  const checks = decisionChecks(detail);
  const exportBrief = () => {
    const brief = { product:'JaanchSetu', prototype:true, exportedAt:new Date().toISOString(), instrument:detail.fdr, reviewChecks:checks, sourceEvidence:detail.truthTable, documentManifest:detail.documents.map((d:any)=>({id:d.id,fileName:d.fileName,sha256:d.sha256,uploadedAt:d.uploadedAt})), discrepancies:detail.discrepancies, releaseRequests:detail.releaseRequests, limitations:'Snapshot of the displayed prototype record. Not an official release order, proof of bank authenticity or authorisation to release funds.' };
    const url=URL.createObjectURL(new Blob([JSON.stringify(brief,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`jaanchsetu-${String(detail.fdr.fdrNumber || detail.fdr.id).replace(/[^a-zA-Z0-9_-]/g,'_')}-decision-brief.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Decision brief exported. This is a prototype record snapshot.');
  };
  return <section className="readiness-panel" aria-label="Evidence review checklist"><div className="readiness-heading"><div><p className="eyebrow"><Icon name="link" size={12}/>Decision context</p><h2>What still needs a closer look?</h2><p>Inspect the evidence before an authorised decision.</p></div><button className="btn-alt btn-sm" onClick={exportBrief}><Icon name="download" size={13}/>Export decision brief</button></div><div className="readiness-checks">{checks.map(c=><button key={c.key} data-passed={c.passed} onClick={()=>openTab(c.tab)}><Icon name={c.passed?'check':'clock'} size={18}/><b>{c.label}</b><small>{c.detail}</small></button>)}</div><p className="readiness-note">This is a review aid, not a release approval. Financial-source values may come from the labelled simulator. The server’s workflow checks and competent-authority decision still apply.{detail.documents[0] ? ` Latest document: ${dt(detail.documents[0].uploadedAt)}.` : ''}</p></section>;
}
