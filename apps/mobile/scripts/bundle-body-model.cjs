/* global __dirname */
// Rebuild the offline preview after editing public/model. Uses the API's existing esbuild.
const { build } = require('../../api/node_modules/esbuild');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const model = path.resolve(__dirname, '../public/model');

async function bundle() {
  const page = readFileSync(path.join(model, 'index.html'), 'utf8');
  let script = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  for (const name of ['rigged-human.glb', 'dumbbell.glb']) {
    const uri = 'data:model/gltf-binary;base64,' + readFileSync(path.join(model, name)).toString('base64');
    script = script.replace(`'./${name}'`, JSON.stringify(uri));
  }
  const imports = script.match(/import[^;]+;/g).join('');
  script = script.replace(/import[^;]+;/g, '');
  const result = await build({
    stdin: { contents: `${imports}(async()=>{${script}})().catch(()=>window.ReactNativeWebView?.postMessage(JSON.stringify({type:'steadyforum:model-error'})));`, resolveDir: model },
    alias: { three: path.join(model, 'three.module.js') },
    bundle: true, minify: true, format: 'iife', target: 'es2020', write: false,
  });
  const bundled = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = page.replace('width=device-width,initial-scale=1', 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no').replace(/<script type="importmap">[\s\S]*?<\/script>/, '')
    .replace(/<script type="module">[\s\S]*?<\/script>/, () => `<script>${bundled}</script>`)
    .replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; connect-src data: blob:;">');
  writeFileSync(path.resolve(__dirname, '../src/components/bodyModel.generated.json'), JSON.stringify({ html }));
}
bundle().catch(error => { console.error(error); process.exitCode = 1; });
