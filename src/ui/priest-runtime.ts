import { PriestBattle, PriestHero, PriestPreferences, PriestView, priestAlertKey, priestBattle, priestHero, priestPreferences, priestView } from './priest-core';
export type PriestContext={available:boolean;enabled:boolean;channel:string;friends:string[];reason:string;serverTime?:string};
export type PriestSnapshot={userId:string;signedIn:boolean;collector:boolean;moduleEnabled:boolean;preferences:PriestPreferences;view:PriestView;error:string;soundReady:boolean};
export type PriestRuntime={ingest:(event:unknown)=>void;setCollector:(enabled:boolean)=>void;getSnapshot:()=>PriestSnapshot;subscribe:(fn:()=>void,kind?:'panel'|'hud')=>()=>void;refresh:()=>Promise<void>;setPreferences:(changes:Partial<PriestPreferences>)=>Promise<void>;setModule:(value:boolean)=>Promise<void>;acceptContext:(context:PriestContext,userId:string)=>void;unlockSound:()=>Promise<void>;testSound:()=>Promise<void>};
type Reply={ok:boolean;error?:string;userId?:string;signedIn?:boolean;collector?:boolean;preferences?:PriestPreferences;data?:PriestContext};
type RuntimeChrome={runtime:{sendMessage:(message:unknown)=>Promise<Reply>;onMessage:{addListener:(fn:(message:{type:string;configuration?:boolean})=>void)=>void}}};
type PriestScope={chrome:RuntimeChrome;__zmaPriest?:PriestRuntime;__zmaHudController?:{notify:(text:string,error:boolean,module:string)=>void}};
const scope=globalThis as unknown as PriestScope;
const channel=/^\/c\/([^/]+)/.exec(location.pathname)?.[1]||'';
if(!scope.__zmaPriest&&window.top===window&&channel){
  let preferences=priestPreferences({}),userId='guest',signedIn=false,collector=false,moduleEnabled=false,hero:PriestHero|null=null,battle:PriestBattle|null=null,error='';
  let pending:{data:unknown;at:number}|null=null,friends:string[]=[],contextAt=0,contextUser='',lastNotice=0,contextPromise:Promise<void>|null=null,localPromise:Promise<void>|null=null;
  let audio:AudioContext|null=null,timer:ReturnType<typeof setInterval>|null=null,lastFingerprint='',snapshot:PriestSnapshot,contextStamp=0;
  const listeners=new Map<()=>void,'panel'|'hud'>(),alerts=new Set<string>();
  const send=(message:unknown)=>scope.chrome.runtime.sendMessage(message);
  function reset(){hero=null;battle=null;pending=null;friends=[];moduleEnabled=false;contextAt=0;contextStamp=0;contextUser='';alerts.clear();lastNotice=0;error='';void audio?.close();audio=null}
  function allowed(){return preferences.enabled&&moduleEnabled&&collector&&signedIn}
  function emit(){
    const view=priestView(battle,{...preferences,enabled:allowed()},friends,Date.now(),hero);
    const next:PriestSnapshot={userId,signedIn,collector,moduleEnabled,preferences,view,error,soundReady:audio?.state==='running'};
    const fingerprint=JSON.stringify(next);
    if(fingerprint===lastFingerprint)return;snapshot=next;lastFingerprint=fingerprint;for(const listener of listeners.keys())listener();
  }
  function beep(){if(!preferences.sound||audio?.state!=='running')return;const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.type='sine';oscillator.frequency.value=700;gain.gain.setValueAtTime(.035,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.16);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+.18);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect()}}
  function tick(){
    if(document.hidden)return;
    if(pending){battle=Date.now()-pending.at<20000?priestBattle(pending.data,hero,pending.at):null;pending=null}
    emit();
    if(allowed()){
      const key=priestAlertKey(snapshot.view);
      if(key&&!alerts.has(key)&&Date.now()-lastNotice>=10000){alerts.add(key);if(alerts.size>64)alerts.delete(alerts.values().next().value!);lastNotice=Date.now();scope.__zmaHudController?.notify(`Жрец: ${snapshot.view.urgent.slice(0,4).map(ally=>`${ally.name} ${Math.round(ally.hp!)}%`).join(', ')}`,false,'priest');beep()}
    }
    if([...listeners.values()].includes('panel')&&signedIn&&Date.now()-contextAt>30000)void refreshContext();
  }
  function schedule(){
    const needed=listeners.size>0&&!document.hidden;
    if(needed&&!timer){tick();timer=setInterval(tick,1000)}
    if(!needed&&timer){clearInterval(timer);timer=null}
  }
  async function local(){
    if(localPromise)return localPromise;
    localPromise=(async()=>{
      try{const reply=await send({type:'priest-state'});if(!reply.ok)throw Error(reply.error);
        if(reply.userId!==userId){reset();userId=reply.userId||'guest'}
        signedIn=!!reply.signedIn;collector=!!reply.collector;preferences=priestPreferences(reply.preferences);
        if(!preferences.enabled||!collector){battle=null;pending=null;alerts.clear();void audio?.close();audio=null}
      }catch(e){error=(e as Error).message;moduleEnabled=false;battle=null;pending=null}
      emit();schedule();
    })().finally(()=>{localPromise=null});return localPromise;
  }
  function acceptContext(context:PriestContext,owner:string){if(owner!==userId||context.channel!==channel)return;const stamp=Date.parse(context.serverTime||'');if(Number.isFinite(stamp)&&stamp<contextStamp)return;if(Number.isFinite(stamp))contextStamp=stamp;moduleEnabled=context.enabled;friends=context.friends.filter(value=>typeof value==='string').slice(0,200);contextAt=Date.now();contextUser=owner;error='';if(!moduleEnabled){battle=null;pending=null;alerts.clear();void audio?.close();audio=null}emit()}
  async function refreshContext(){
    if(contextPromise)return contextPromise;
    const owner=userId;
    contextPromise=(async()=>{try{const reply=await send({type:'priest-context'});if(!reply.ok)throw Error(reply.error);if(owner===userId&&reply.userId===userId&&reply.data)acceptContext(reply.data,userId)}catch(e){if(owner===userId){error=(e as Error).message;moduleEnabled=false;battle=null;pending=null;contextAt=Date.now();emit()}}})().finally(()=>{contextPromise=null});return contextPromise;
  }
  emit();
  scope.__zmaPriest={
    ingest(event){
      if(!event||typeof event!=='object')return;
      const raw=event as {path?:string;eventType?:string;kind?:string;status?:number;response?:Record<string,unknown>};
      if(!collector||raw.status!==undefined&&raw.status!==200||!raw.response||raw.response.ok===false)return;
      const path=raw.path?.replace(/^\/c\/[^/]+/,'');
      if(path==='/api/me'||path==='/api/live'&&raw.eventType==='me'){
        const oldLogin=hero?.login;hero=priestHero(raw.response.hero,hero);
        if(oldLogin&&hero?.login!==oldLogin||hero&&hero.role!=='priest'){battle=null;pending=null;alerts.clear()}
        if(allowed()&&'ql'in raw.response)pending={data:raw.response.ql,at:Date.now()};
      }else if(allowed()&&path==='/api/live'&&raw.kind==='sse-message'&&raw.eventType==='q')pending={data:raw.response,at:Date.now()};
    },
    setCollector(value){collector=value;if(!value){battle=null;pending=null;hero=null;alerts.clear();void audio?.close();audio=null}emit()},
    getSnapshot:()=>snapshot,
    subscribe(fn,kind='panel'){listeners.set(fn,kind);schedule();void local().then(()=>{if(kind==='panel'&&signedIn)return refreshContext()});return()=>{listeners.delete(fn);schedule()}},
    refresh:async()=>{await local();if(signedIn)await refreshContext();tick()},
    async setPreferences(changes){
      const owner=userId,next=priestPreferences({...preferences,...changes}),reply=await send({type:'priest-preferences',userId:owner,preferences:next});
      if(!reply.ok)throw Error(reply.error);if(owner!==userId)return;preferences=next;
      if(!next.enabled){battle=null;pending=null;alerts.clear();void audio?.close();audio=null}
      if(!next.sound&&audio){void audio.close();audio=null}emit();schedule();
    },
    async setModule(value){await contextPromise;const reply=await send({type:'priest-module',enabled:value});if(!reply.ok)throw Error(reply.error);await refreshContext()},
    acceptContext,
    async unlockSound(){if(!audio)audio=new AudioContext();await audio.resume();emit()},
    async testSound(){if(!audio)audio=new AudioContext();await audio.resume();if(!preferences.sound)throw Error('Сначала включите звук');beep();emit()},
  };
  scope.chrome.runtime.onMessage.addListener(message=>{if(message.type==='hud-state-changed'&&message.configuration)void local().then(()=>{if([...listeners.values()].includes('panel')&&signedIn&&contextUser!==userId)return refreshContext()})});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){void audio?.suspend();schedule()}else{schedule();if(listeners.size)void local()}});
  void local();
}
