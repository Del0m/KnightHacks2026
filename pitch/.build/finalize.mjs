import fs from 'node:fs/promises';
import {FileBlob,PresentationFile} from '@oai/artifact-tool';
import {finalizePresentation} from '/Users/brayden/.codex/plugins/cache/openai-primary-runtime/presentations/26.1009.11318/skills/presentations/container_tools/artifact_tool_utils.mjs';
const base='/Users/brayden/Downloads/KnightHacks2026/pitch';
const skill='/Users/brayden/.codex/plugins/cache/openai-primary-runtime/presentations/26.1009.11318/skills/presentations';
const result=await finalizePresentation({workspaceDir:base,candidatePath:base+'/.build/candidate.pptx',finalPath:base+'/output/Presentation.pptx',pythonExecutable:'/Users/brayden/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],explicitTotalSlideCount:3,fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,receiptPath:base+'/.build/validation.json'});
console.log(JSON.stringify(result));
const p=await PresentationFile.importPptx(await FileBlob.load(base+'/output/Presentation.pptx'));
for(let i=0;i<p.slides.items.length;i++){const png=await p.export({slide:p.slides.items[i],format:'png',scale:1});await fs.writeFile(base+'/.build/slide'+(i+1)+'.png',new Uint8Array(await png.arrayBuffer()));}
console.log('Rendered all 3 slides');
