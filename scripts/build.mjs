import {readFileSync,writeFileSync,mkdirSync,cpSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const dir=join(root,'dist','unpacked');
rmSync(join(root,'dist'),{recursive:true,force:true});
mkdirSync(dir,{recursive:true});
for(const f of ['manifest.json','popup.html','dashboard.html'])cpSync(join(root,f),join(dir,f));
cpSync(join(root,'src'),join(dir,'src'),{recursive:true});
cpSync(join(root,'icons'),join(dir,'icons'),{recursive:true});
const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
const cid=process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
if(cid){
  if(!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(cid))throw Error('GOOGLE_OAUTH_CLIENT_ID 格式不合法');
  manifest.oauth2.client_id=cid;
}
writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const code=`import os, zipfile\nfrom pathlib import Path\nroot=Path(${JSON.stringify(dir)})\nout=Path(${JSON.stringify(join(root,'dist','VPSFolio-Chrome-Extension.zip'))})\nwith zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:\n    for p in sorted(root.rglob('*')):\n        if p.is_file(): z.write(p,p.relative_to(root))\nprint(out)`;
const result=spawnSync(process.env.PYTHON || (process.platform==='win32' ? 'python' : 'python3'),['-c',code],{encoding:'utf8'});
if(result.status!==0)throw Error(result.stderr);
console.log(result.stdout);
