// LegionFrontSRC 518de566: quest.js meIn(), qaBattle(), b.low and b.sk.
export const PRIEST_STALE_MS=20000;
export type PriestPreferences={enabled:boolean;sound:boolean;threshold:number;watched:string[]};
export type PriestHero={login:string;role:string};
export type PriestAlly={login:string;name:string;hp:number|null;friend:boolean;selected:boolean};
export type PriestSkill={name:string;cooldown:number|null};
export type PriestBattle={id:string;round:number|null;phase:string;party:string;ownHp:number|null;role:string;self:string;turnTaken:boolean;forbidden:boolean;until:number|null;allies:PriestAlly[];skills:PriestSkill[];skillsKnown:boolean;at:number};
export type PriestView={eligible:boolean;fresh:boolean;canAct:boolean;reason:string;battle:PriestBattle|null;allies:PriestAlly[];urgent:PriestAlly[]};
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const login=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(value)?value.toLowerCase():'';
const text=(value:unknown,fallback='')=>typeof value==='string'?value.slice(0,150):fallback;
export function priestPreferences(value:unknown):PriestPreferences{
  const raw=object(value);return {enabled:raw.enabled===true,sound:raw.sound===true,threshold:finite(raw.threshold)?Math.max(1,Math.min(99,raw.threshold)):25,watched:[...new Set((Array.isArray(raw.watched)?raw.watched:[]).map(login).filter(Boolean))].slice(0,50)};
}
export function priestHero(raw:unknown,previous:PriestHero|null):PriestHero|null{
  const hero=object(raw);if(!Object.keys(hero).length)return previous;
  const role=text(hero.role)||text(object(hero.sk).c)||previous?.role||'';
  return {login:login(hero.login)||previous?.login||'',role};
}
export function priestBattle(raw:unknown,hero:PriestHero|null,at:number):PriestBattle|null{
  const quest=object(raw),battle=object(quest.b);if(quest.on!==true||!Object.keys(battle).length)return null;
  const form=Array.isArray(battle.form)?battle.form.slice(0,1000):[],me=finite(battle.me)&&Number.isInteger(battle.me)&&battle.me>=0?form[battle.me]:null;
  const formation=Array.isArray(me)?me:null,mf=Array.isArray(battle.mf)?battle.mf:null;
  const self=hero?.login||(formation?login(formation[0]):'');
  const role=(formation?text(formation[1]):mf?text(mf[0]):'')||hero?.role||'';
  const allies=new Map<string,PriestAlly>();
  for(const row of form){if(!Array.isArray(row))continue;const id=login(row[0]);if(id&&id!==self)allies.set(id,{login:id,name:id,hp:null,friend:false,selected:false})}
  for(const row of Array.isArray(battle.low)?battle.low.slice(0,1000):[]){
    if(!Array.isArray(row))continue;const id=login(row[0]);if(!id||id===self)continue;
    // A value of 25 is malformed, not 25 percent: the game contract is 0..1.
    const hp=finite(row[2])&&row[2]>=0&&row[2]<=1?row[2]*100:null,old=allies.get(id);
    allies.set(id,{login:id,name:text(row[1],id),hp:old?.hp!=null&&hp!=null?Math.min(old.hp,hp):old?.hp??hp,friend:false,selected:false});
  }
  const skills:PriestSkill[]=[];
  for(const row of Array.isArray(battle.sk)?battle.sk.slice(0,100):[]){if(!Array.isArray(row)||row[2]!=='heal'||typeof row[0]!=='string')continue;skills.push({name:text(row[0]),cooldown:finite(row[1])&&Number.isInteger(row[1])&&row[1]>=0?row[1]:null})}
  return {id:typeof battle.id==='number'||typeof battle.id==='string'?String(battle.id).slice(0,100):'',round:finite(battle.round)?battle.round:null,phase:text(battle.st),party:text(quest.party),ownHp:finite(battle.hp)&&battle.hp<=1?battle.hp:null,role,self,turnTaken:!!battle.turn,forbidden:!!object(battle.gb).forbid,until:finite(battle.until)?battle.until:null,allies:[...allies.values()],skills,skillsKnown:Array.isArray(battle.sk),at};
}
export function priestView(battle:PriestBattle|null,prefs:PriestPreferences,friends:string[],now:number,hero:PriestHero|null=null):PriestView{
  const fresh=!!battle&&now-battle.at>=0&&now-battle.at<PRIEST_STALE_MS;
  const reason=!prefs.enabled?'Помощник выключен':hero&&hero.role&&hero.role!=='priest'?'Доступно жрецу':!battle?'Нет свежего снимка боя. Дождитесь обычного обновления похода.':battle.role!=='priest'||hero&&hero.role&&hero.role!=='priest'?'Доступно жрецу':battle.party!=='in'?'Ваш герой не в отряде':battle.ownHp==null?'Участие героя в бою не подтверждено':battle.ownHp<=0?'Герой пал или покинул бой':battle.phase==='end'?'Бой окончен':!fresh?'Снимок устарел. Готовность не подтверждена.':'';
  const eligible=!reason,canAct=eligible&&battle?.phase==='party'&&!battle.turnTaken&&!battle.forbidden&&(battle.until==null||battle.until>now)||false;
  const friendSet=new Set(friends.map(value=>value.toLowerCase())),watchSet=new Set(prefs.watched);
  const allies=(battle?.allies||[]).map(ally=>({...ally,friend:friendSet.has(ally.login),selected:watchSet.has(ally.login)})).sort((a,b)=>(a.hp??101)-(b.hp??101)||Number(b.selected)-Number(a.selected)||Number(b.friend)-Number(a.friend)||a.login.localeCompare(b.login));
  const urgent=canAct?allies.filter(ally=>ally.hp!=null&&ally.hp>0&&ally.hp<=prefs.threshold):[];
  return {eligible,fresh,canAct,reason,battle,allies,urgent};
}
export function priestAlertKey(view:PriestView):string|null{
  if(!view.canAct||!view.urgent.length||!view.battle)return null;
  return `${view.battle.id}|${view.battle.round??''}|${view.urgent.map(ally=>ally.login).sort().join(',')}`;
}
