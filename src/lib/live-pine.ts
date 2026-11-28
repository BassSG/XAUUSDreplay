import type {Bar} from './engine';
import type {Period} from './live-market.ts';
import type {MarketSymbol} from './market-symbol.ts';
export type LivePineFrame = {asOf: number; minutes: Bar[]; nativeHistory?: boolean; replay?: boolean; symbol?: MarketSymbol};
export const maxPineSourceBars = 6000;
export type PineHistoryQuery = {period: Period; before: number; limit: number};
export type PineHistoryLoader = (query: PineHistoryQuery) => Promise<Bar[]>;

export function checkPineIndicator(source: string) {
  if (source.length > 250000) throw Error('สคริปต์ยาวเกิน 250,000 ตัวอักษร');
  const version = source.match(/^\s*\/\/@version\s*=\s*(\d+)\s*$/m)?.[1];
  if (version !== '5' && version !== '6') throw Error('ใช้ซอร์ส Pine Script ที่มีบรรทัด //@version=5 หรือ //@version=6');
  const tokens = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*/g, match => ' '.repeat(match.length));
  if (/^\s*strategy\s*\(/m.test(tokens)) throw Error('Pine Editor รองรับอินดิเคเตอร์ที่ประกาศด้วย indicator() ส่วน strategy() ยังใช้ไม่ได้');
  if (/^\s*import\b/m.test(tokens)) throw Error('สคริปต์นี้ใช้ Pine library import ซึ่งยังไม่รองรับ');
  const declaration = /^\s*indicator\s*\(/m.exec(tokens);
  if (!declaration) throw Error('ไม่พบคำประกาศ indicator() ในซอร์ส');
  const args = source.slice(declaration.index + declaration[0].length);
  return args.match(/^\s*(?:title\s*=\s*)?["']([^"'\n]+)["']/)?.[1]?.trim().slice(0, 120) || 'Custom Pine';
}
