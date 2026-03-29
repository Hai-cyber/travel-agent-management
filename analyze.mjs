import { readFileSync } from 'fs';
const bridge = readFileSync('public/editor-bridge.js','utf8');
const ve     = readFileSync('public/visual-editor.html','utf8');

const fns   = (bridge.match(/function \w+/g)||[]).map(f=>f.slice(9));
const recv  = (bridge.match(/msg === ['"][A-Z_]+['"]/g)||[]).map(m=>m.replace(/msg === ['"]/,'').replace(/['"]/,''));
const sends = [...new Set((bridge.match(/type:\s*['"][A-Z_]+['"]/g)||[]).map(m=>m.replace(/type:\s*['"]/,'').replace(/['"]/,'')))];
const apis  = [...new Set((ve.match(/api\/[a-z/:-]+/g)||[]))];
const evts  = (ve.match(/addEventListener\('[a-z]+'/g)||[]).length;

console.log('BRIDGE fns   :', fns.join(', '));
console.log('BRIDGE recv  :', recv.join(', '));
console.log('BRIDGE sends :', sends.join(', '));
console.log('VE apis      :', apis.join(', '));
console.log('VE listeners :', evts);
