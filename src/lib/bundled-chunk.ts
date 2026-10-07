import {gunzipSync} from 'fflate';
export type ChunkDescriptor={file:string;start:number;end:number;count:number;sha256?:string;contentSha256?:string};
export async function decodeChunk(bytes:ArrayBuffer,descriptor:ChunkDescriptor):Promise<string>{
 const raw=new Uint8Array(bytes);const zipped=raw[0]===31&&raw[1]===139;
 const hash=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b.slice().buffer)),n=>n.toString(16).padStart(2,'0')).join('');
 if(zipped&&descriptor.sha256&&await hash(raw)!==descriptor.sha256.toLowerCase())throw Error('ไฟล์ราคาดาวน์โหลดไม่สมบูรณ์');
 const payload=zipped?gunzipSync(raw):raw;
 const expected=descriptor.contentSha256??(!descriptor.file.endsWith('.gz')?descriptor.sha256:undefined);
 if(expected&&await hash(payload)!==expected.toLowerCase())throw Error('ไฟล์ราคาดาวน์โหลดไม่สมบูรณ์');
 if(!zipped&&descriptor.file.endsWith('.gz')&&descriptor.sha256&&!expected)throw Error('รายการข้อมูลรุ่นเก่า กรุณาอัปเดตแอปแล้วลองใหม่');
 return new TextDecoder().decode(payload);
}
