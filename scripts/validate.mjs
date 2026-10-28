import {readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
const dir=resolve(import.meta.dirname,'../dist/unpacked');
const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
if(manifest.manifest_version!==3)throw Error('Expected MV3');
for(const p of [manifest.background.service_worker,manifest.action.default_popup,manifest.options_page,'icons/128.png']){
  if(!existsSync(join(dir,p)))throw Error(`Missing ${p}`);
}
if(!existsSync(resolve(dir,'../VPSFolio-Chrome-Extension.zip')))throw Error('Missing archive');
console.log('Chrome extension structure OK');
