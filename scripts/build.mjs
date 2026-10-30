import {build} from 'vite';
import react from '@vitejs/plugin-react';
const common={configFile:false,publicDir:false,define:{'process.env.NODE_ENV':JSON.stringify('production')}};
for(const [entry,name,file,empty] of [['src/ui/entry.tsx','ZakvielAuctionUI','auction.js',true],['src/runtime/service-worker.js','ZakvielWorker','worker.js',false]]){
  await build({...common,plugins:file==='auction.js'?[react()]:[],build:{outDir:'build',emptyOutDir:empty,lib:{entry,name,formats:['iife'],fileName:()=>file}}});
}
await import('./assemble.mjs');
