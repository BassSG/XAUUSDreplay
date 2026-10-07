import type {IndicatorSpec} from './engine';
export type BuiltinIndicator={id:string;name:string;description:string;file:string;sha256:string;legacyHash:string};
export const builtinIndicators:BuiltinIndicator[]=[
 {id:'all-indy-v10.4.4',name:'All Indy (EBW) V10.4.4',description:'EBW V10.4.4 · Stochastic + RSI · Zone Bridge 1.1',file:'indicators/all-indy-v10.4.4-full.pine',sha256:'66f0c426e0d827616711bd115ba90eaad5fce7c26b0f9334299e62dbc0487107',legacyHash:'068f63d68a515aa481211fac426fcef7ceb7760cea45919ab6b7848e846232df'},
 {id:'ebw-fibo-1.9',name:'EBW-Fibo 1.9 · Strength Map',description:'Fibonacci · Hero TF · Strength Map · Zone Bridge inputs',file:'indicators/ebw-fibo-1.9-full.pine',sha256:'581f4746eea09bef25e2762ff4a49a7d8101fb111bf13ce99446988cd7b98d72',legacyHash:'fb059a0d4bf9fa83a6b1c760f79b7f2ba0baed13c2742734efad98e24f803edb'}
];
export async function loadBuiltinIndicator(item:BuiltinIndicator){
 const r=await fetch(import.meta.env.BASE_URL+item.file,{cache:'no-cache'});
 if(!r.ok)throw Error('โหลด '+item.name+' ไม่สำเร็จ');
 const text=await r.text();if(await sourceHash(text)!==item.sha256)throw Error('ไฟล์ '+item.name+' ไม่ตรงฉบับเต็ม กรุณาอัปเดตแอปแล้วลองใหม่');return text;
}
export async function sourceHash(source:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source))),n=>n.toString(16).padStart(2,'0')).join('');}
export async function upgradeBundledIndicators(specs:IndicatorSpec[],load=loadBuiltinIndicator){
 const errors:string[]=[];let changed=false;const indicators:IndicatorSpec[]=[];
 for(const spec of specs){const hash=await sourceHash(spec.source.replace(/\r\n/g,'\n').trimEnd());const builtin=builtinIndicators.find(i=>i.legacyHash===hash);
  if(!builtin){indicators.push(spec);continue;}
  try{indicators.push({...spec,source:await load(builtin),builtinId:builtin.id});changed=true;}catch{indicators.push(spec);errors.push('อัปเดต '+builtin.name+' เป็นฉบับเต็มไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วเพิ่มฉบับเต็มใน Indicators');}
 }return {indicators,changed,errors};
}
