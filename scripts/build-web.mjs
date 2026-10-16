import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('public/assets',{recursive:true});
await build({entryPoints:['web/app.tsx'],bundle:true,minify:true,outdir:'public/assets',loader:{'.woff2':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await copyFile('web/index.html','public/index.html');
await copyFile('web/styles.css','public/styles.css');
