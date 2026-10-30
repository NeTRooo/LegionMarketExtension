// Client-only shared UI. The dashboard's settings pages and server code are not
// dependencies of the distributable userscript.
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';

export type Settings = {schemaVersion:1;modules:Record<'enchant'|'skills'|'auction'|'players'|'hud'|'priest'|'chat'|'sevenTV',boolean>;privacy:{syncChat:false;syncDM:false;presenceRetentionHours:number}};
const labels:Record<string,string>={hp:'Здоровье',atk:'Атака',mag:'Магия',def:'Броня',crit:'Шанс крита',critDmg:'Сила крита',dodge:'Уклонение',pierce:'Пробивание',healPow:'Сила лечения',luck:'Удача',resist:'Сопротивление'};
export const formatStats=(stats:Record<string,number>)=>Object.entries(stats).map(([key,value])=>`${labels[key]||key}: ${value}`).join(' · ')||'Нет характеристик';

export async function api<T>(path:string,_token:string,init:RequestInit={}):Promise<T>{
  init.signal?.throwIfAborted();
  const runtime=(globalThis as unknown as {chrome:{runtime:{sendMessage:(message:unknown)=>Promise<{ok:boolean;error?:string;data:T}>}}}).chrome.runtime;
  const reply=await runtime.sendMessage({type:path.startsWith('/api/auction/')?'auction-query':'players-request',path,method:init.method||'GET',...(init.body?{body:init.body}:{})});
  init.signal?.throwIfAborted();
  if(!reply.ok)throw Error(reply.error||'Ошибка API');
  return reply.data;
}

type Notice={id:number;text:string;error:boolean};
const refreshSettings=async()=>{}; // Panels load their settings through the authenticated client bridge.
const Context=createContext<{notify:(text:string,error?:boolean)=>void;refreshSettings:()=>Promise<void>}>({notify:()=>{},refreshSettings});
export const useFoundation=()=>useContext(Context);
export function FoundationProvider({children,onNotify}:{token:string;children:ReactNode;onNotify?:(text:string,error:boolean)=>void}){
  const [notices,setNotices]=useState<Notice[]>([]),counter=useRef(0),timers=useRef(new Set<ReturnType<typeof setTimeout>>());
  const notify=(text:string,error=false)=>{
    const id=++counter.current;setNotices(list=>[...list.slice(-3),{id,text,error}]);onNotify?.(text,error);
    const timer=setTimeout(()=>{timers.current.delete(timer);setNotices(list=>list.filter(item=>item.id!==id));},7000);timers.current.add(timer);
  };
  useEffect(()=>()=>{for(const timer of timers.current)clearTimeout(timer);timers.current.clear();},[]);
  return <Context.Provider value={{notify,refreshSettings}}>{children}<div className="notices" aria-live="polite">{notices.map(notice=><div key={notice.id} className={notice.error?'notice error':'notice'}>{notice.text}<button aria-label="Закрыть уведомление" onClick={()=>setNotices(list=>list.filter(item=>item.id!==notice.id))}>×</button></div>)}</div></Context.Provider>;
}
