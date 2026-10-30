import {readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url), allowed=new Set([".gitignore","AGENTS.md","LICENSE","README.md","THIRD_PARTY_NOTICES.md","dist/ZakvielMarket.user.js","docs/SOURCE_CHECKS.md","package-lock.json","package.json","scripts/assemble.mjs","scripts/build.mjs","scripts/check-distribution.mjs","src/runtime/auction-api.mjs","src/runtime/auction-panel.js","src/runtime/collector-main.js","src/runtime/content-bridge.js","src/runtime/hud-panel.js","src/runtime/hud-state.mjs","src/runtime/players-api.mjs","src/runtime/priest-state.mjs","src/runtime/service-worker.js","src/tampermonkey/platform.mjs","src/tampermonkey/settings.js","src/ui/Auction.tsx","src/ui/Players.tsx","src/ui/Priest.tsx","src/ui/auction.css","src/ui/entry.tsx","src/ui/extension-auction.css","src/ui/foundation.tsx","src/ui/players.css","src/ui/priest-core.ts","src/ui/priest-runtime.ts","src/ui/priest.css","src/ui/vite-env.d.ts","tests/auction.test.cjs","tests/browser-smoke.cjs","tests/collector.test.cjs","tests/hud.test.cjs","tests/platform.test.mjs","tests/players.test.cjs","tests/priest.test.cjs","tsconfig.json"]);
async function scan(dir=''){
 for(const item of await readdir(new URL(dir,root),{withFileTypes:true})){
  const path=dir+item.name;if(['.git','node_modules','build','.data'].includes(path))continue;
  if(item.isSymbolicLink())throw Error('Symlink prohibited: '+path);
  if(item.isDirectory())await scan(path+'/');else{
   if(!allowed.has(path))throw Error('File outside client allowlist: '+path);
   const text=await readFile(new URL(path,root),'utf8');
   if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|postgresql:\/\//.test(text))throw Error('Sensitive content: '+path);
  }
 }
}
await scan();
for(const path of execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))if(!allowed.has(path))throw Error('Git file outside client allowlist: '+path);
console.log('Client-only distribution checked');
