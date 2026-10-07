import {useEffect,useRef} from 'react';
export function useDialog(open:boolean,close:()=>void){
 const latest=useRef(close);latest.current=close;
 useEffect(()=>{if(!open)return;const previous=document.activeElement as HTMLElement|null;const dialog=document.querySelector<HTMLElement>('[aria-modal="true"]');if(!dialog)return;
  const items=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(el=>el.getClientRects().length>0);
  items()[0]?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();latest.current();return;}if(e.key!=='Tab')return;const list=items();if(!list.length){e.preventDefault();return;}const first=list[0],last=list.at(-1)!;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}};dialog.addEventListener('keydown',key);return()=>{dialog.removeEventListener('keydown',key);previous?.focus()};
 },[open]);
}
