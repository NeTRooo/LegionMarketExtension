import { useEffect, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import Auction, { AuctionRequest, AuctionStorage } from './Auction';
import Players, { PlayersRequest } from './Players';
import Priest from './Priest';
import { FoundationProvider } from './foundation';
import auctionCss from './auction.css?inline';
import baseCss from './extension-auction.css?inline';
import playersCss from './players.css?inline';
import priestCss from './priest.css?inline';

type ExtensionRuntime = {
  runtime: {sendMessage(message:unknown):Promise<{ok?:boolean;error?:string;data?:unknown;signedIn?:boolean;user?:{id:string;login:string}}>};
  storage: {local:{get(keys:string[]):Promise<Record<string,unknown>>;set(value:Record<string,string>):Promise<void>};onChanged:{addListener(fn:(changes:Record<string,unknown>,area:string)=>void):void;removeListener(fn:(changes:Record<string,unknown>,area:string)=>void):void}};
};
const extension = (globalThis as unknown as {chrome:ExtensionRuntime}).chrome;
const request:AuctionRequest = async <T,>(path:string,signal?:AbortSignal):Promise<T> => {
  signal?.throwIfAborted();
  const response=await extension.runtime.sendMessage({type:'auction-query',path});
  signal?.throwIfAborted();
  if(!response.ok)throw Error(response.error||'Не удалось загрузить аукцион');
  return response.data as T;
};
const money=(value=0)=>`${value.toLocaleString('ru-RU',{maximumFractionDigits:2})} мед.`;
const privateRequest:PlayersRequest=async <T,>(path:string,init:RequestInit={}):Promise<T>=>{
  init.signal?.throwIfAborted();
  const result=await extension.runtime.sendMessage({type:'players-request',path,method:init.method||'GET',...(init.body?{body:init.body}:{})});
  init.signal?.throwIfAborted();
  if(!result.ok)throw Error(result.error||'Не удалось загрузить игроков');
  return result.data as T;
};

function ExtensionAuction({channel,refreshVersion,view,target}:{channel:string;refreshVersion:number;view:'auction'|'players'|'priest';target:{channel:string;seller:string}|null}){
  const [context,setContext]=useState<{user:{id:string;login:string}|null;storage:AuctionStorage}|null>(null),[storageError,setStorageError]=useState('');
  useEffect(()=>{
    let active=true,sequence=0;
    const update=async()=>{
      const current=++sequence;setContext(null);setStorageError('');
      try{
        const result=await extension.runtime.sendMessage({type:'get-auth'}),user=result.signedIn?result.user||null:null;
        const keys=[`zma-auction-watch:${user?.id||'guest'}`,`zma-auction-seen:${user?.id||'guest'}`];
        const saved=await extension.storage.local.get(keys),cache=new Map(keys.map(key=>[key,typeof saved[key]==='string'?saved[key] as string:null]));
        if(!active||current!==sequence)return;
        const storage:AuctionStorage={getItem:key=>cache.get(key)||null,setItem(key,value){if(!keys.includes(key))throw Error('Недопустимый ключ');cache.set(key,value);void extension.storage.local.set({[key]:value}).catch(()=>{if(active&&current===sequence)setStorageError('Не удалось сохранить наблюдение в хранилище расширения')})}};
        setContext({user,storage});
      }catch{if(active&&current===sequence)setStorageError('Не удалось прочитать настройки расширения. Перезагрузите страницу игры.')}
    };
    const changed=(changes:Record<string,unknown>,area:string)=>{if(area==='local'&&('authUser'in changes||'authToken'in changes))void update()};
    void update();extension.storage.onChanged.addListener(changed);
    return()=>{active=false;extension.storage.onChanged.removeListener(changed)};
  },[]);
  if(!context)return <p role="status">{storageError||'Подключаем аукцион…'}</p>;
  const {user,storage}=context;
  return <FoundationProvider token="" onNotify={(text,error)=>(globalThis as unknown as {__zmaHudController?:{notify:(text:string,error:boolean,module:string)=>void}}).__zmaHudController?.notify(text,error,view)}>{storageError&&<p role="alert">{storageError}</p>}<p className="extension-context">{user?`Аккаунт расширения: ${user.login}`:"Для личного списка игроков и свежих снимков войдите через popup расширения."}</p>{view==='priest'?<Priest/>:view==='players'?(user?<Players key={user.id} request={privateRequest} onSeller={(channel,seller)=>scope.__zmaAuctionApp?.showSeller(channel,seller)}/>:<p>Список друзей и наблюдений приватен. Войдите в popup расширения.</p>):<Auction key={`${user?.id||'guest'}:${target?.channel||''}:${target?.seller||''}`} userId={user?.id||'guest'} money={money} request={request} storage={storage} initialChannel={target?.channel||channel} initialSeller={target?.seller} refreshVersion={refreshVersion}/>}</FoundationProvider>;
}

type AuctionApp={mount:(container:HTMLElement,channel:string,view?:'auction'|'players'|'priest')=>void;refresh:()=>void;unmount:()=>void;setView:(view:'auction'|'players'|'priest')=>void;showSeller:(channel:string,seller:string)=>void;onViewChange?:(view:'auction'|'players'|'priest')=>void};
const scope=globalThis as unknown as {__zmaAuctionApp?:AuctionApp};
if(!scope.__zmaAuctionApp){
  let root:Root|null=null,channel='',refreshVersion=0,view:'auction'|'players'|'priest'='auction',target:{channel:string;seller:string}|null=null;
  const render=()=>root?.render(<ExtensionAuction channel={channel} refreshVersion={refreshVersion} view={view} target={target}/>);
  scope.__zmaAuctionApp={
    mount(container,nextChannel,nextView='auction'){
      root?.unmount();container.replaceChildren();
      const style=document.createElement('style');style.textContent=baseCss+'\n'+auctionCss+'\n'+playersCss+'\n'+priestCss;
      const app=document.createElement('div');app.className='zma-auction-root';container.append(style,app);
      channel=nextChannel;view=nextView;target=null;refreshVersion=0;root=createRoot(app);render();
    },
    refresh(){refreshVersion++;render()},
    setView(nextView){view=nextView;target=null;render()},
    showSeller(nextChannel,seller){target={channel:nextChannel,seller};view='auction';scope.__zmaAuctionApp?.onViewChange?.(view);render()},
    unmount(){root?.unmount();root=null},
  };
}
