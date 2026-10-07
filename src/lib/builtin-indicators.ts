export type BuiltinIndicator={id:string;name:string;description:string;file:string};
export const builtinIndicators:BuiltinIndicator[]=[
 {id:'all-indy-v10.4.4',name:'All Indy (EBW) V10.4.4',description:'EBW V10.4.4 · Stochastic + RSI · Zone Bridge 1.1',file:'indicators/all-indy-v10.4.4.pine'},
 {id:'ebw-fibo-1.9',name:'EBW-Fibo 1.9 · Strength Map',description:'Fibonacci · Hero TF · Strength Map · Zone Bridge inputs',file:'indicators/ebw-fibo-1.9.pine'}
];
export async function loadBuiltinIndicator(item:BuiltinIndicator){
 const r=await fetch(import.meta.env.BASE_URL+item.file,{cache:'no-cache'});
 if(!r.ok)throw Error('โหลด '+item.name+' ไม่สำเร็จ');
 return r.text();
}
