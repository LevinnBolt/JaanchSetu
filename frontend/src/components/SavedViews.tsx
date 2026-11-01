import { useState } from 'react';
import { Icon, promptText, toast, useMe } from '../ui';
interface SavedView { name:string; query:string; }
export default function SavedViews({query,apply}:{query:string;apply:(q:string)=>void}) {
  const {me}=useMe();
  const key=`jaanchsetu_views_v1_${me.id}`;
  const [views,setViews]=useState<SavedView[]>(()=>{try{const v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?v.filter(x=>typeof x.name==='string' && typeof x.query==='string').slice(0,6):[];}catch{return [];}});
  const save=(next:SavedView[])=>{try{localStorage.setItem(key,JSON.stringify(next));setViews(next);}catch{toast('Your browser could not save this view.','err');}};
  return <div className="saved-views"><Icon name="folder" size={14}/><span>Your saved views</span>{!views.length && <span>Keep a useful filter one click away.</span>}{views.map((v,i)=><div className="saved-view" key={v.name}><button onClick={()=>apply(v.query)}>{v.name}</button><button aria-label={`Remove saved view ${v.name}`} onClick={()=>save(views.filter((_,n)=>n!==i))}><Icon name="x" size={11}/></button></div>)}<button disabled={views.length>=6} onClick={async()=>{const name=await promptText({title:'Save this register view',label:'Name for the current filters',min:1,confirmText:'Save view'});if(name){if(views.some(v=>v.name===name.trim().slice(0,35))){toast('Choose a different name for this view.','info');return;}save([...views,{name:name.trim().slice(0,35),query}]);}}}><Icon name="plus" size={13}/>{views.length>=6?'6-view limit':'Save current view'}</button></div>;
}
