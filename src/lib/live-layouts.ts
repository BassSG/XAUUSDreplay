import {z} from 'zod';
import {drawingKinds, drawingTools, isStroke, strokeMax, variableDrawingsMax} from './drawing-definitions.ts';
import {periods, type Period} from './live-market.ts';
import {studyDefinitions, type LiveStudy} from './live-indicators.ts';
import {drawingSchema, indicatorSchema} from './storage.ts';
import {marketSymbols, defaultMarketSymbol, type MarketSymbol} from './market-symbol.ts';

export const workspaceKey = 'xau-live-workspace-v1';
export const workspaceStorageKey = (symbol: MarketSymbol) => symbol === defaultMarketSymbol ? workspaceKey : workspaceKey + '-' + symbol;
export const periodList = Object.keys(periods) as [Period, ...Period[]];
const studyIds = Object.keys(studyDefinitions) as [LiveStudy, ...LiveStudy[]];
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const appearanceSchema = z.object({
  background: color, text: color, grid: color, verticalGrid: z.boolean(), horizontalGrid: z.boolean(),
  upColor: color, downColor: color, wickUpColor: color, wickDownColor: color,
  borderUpColor: color, borderDownColor: color, wickVisible: z.boolean(), borderVisible: z.boolean(),
  pineText: z.boolean(), pineTables: z.boolean(), studyTitles: z.boolean().default(true),
});
export type ChartAppearance = z.infer<typeof appearanceSchema>;
export const defaultAppearance: ChartAppearance = {
  background: '#0d141e', text: '#93a4ba', grid: '#1a2635', verticalGrid: true, horizontalGrid: true,
  upColor: '#35c4a0', downColor: '#ef6b79', wickUpColor: '#35c4a0', wickDownColor: '#ef6b79',
  borderUpColor: '#35c4a0', borderDownColor: '#ef6b79', wickVisible: true, borderVisible: false,
  pineText: true, pineTables: true, studyTitles: true,
};
export const appearancePresets = {
  'กลางคืน': defaultAppearance,
  'สว่าง': {...defaultAppearance, background: '#ffffff', text: '#344456', grid: '#e6ebf1',
    upColor: '#00876c', wickUpColor: '#00876c', borderUpColor: '#00876c',
    downColor: '#c23d50', wickDownColor: '#c23d50', borderDownColor: '#c23d50'},
  'ดำสนิท': {...defaultAppearance, background: '#080809', text: '#c8c8ce', grid: '#262629',
    verticalGrid: false, horizontalGrid: false, upColor: '#f5f5f7', wickUpColor: '#f5f5f7', borderUpColor: '#f5f5f7',
    downColor: '#e94257', wickDownColor: '#e94257', borderDownColor: '#e94257'},
} satisfies Record<string, ChartAppearance>;

const drawing = drawingSchema.extend({id: z.string().min(1).max(128)}).refine(d => {
  const tool = drawingTools[d.kind];
  const count = d.points.length;
  if (!d.pane && d.points.some(point=>point.price<=0)) return false;
  if (isStroke(d.kind)) return count >= 2 && count <= strokeMax;
  return tool.variable ? count >= 2 && count <= variableDrawingsMax : count === tool.points.length;
}).refine(d => d.points.every(point => point.time < 8640000000000));
const favoriteTools = z.array(z.enum(drawingKinds)).max(drawingKinds.length).default([]);
const favoritePosition = z.object({x: z.number().min(0).max(1), y: z.number().min(0).max(1)}).default({x: .5, y: .82});
const favoriteSize = z.enum(['small', 'medium', 'large']).default('medium');
const studyVisibility = z.array(z.string().min(1).max(128)).default([]);
const workspaceSchema = z.object({
  period: z.enum(periodList), chartLayout: z.enum(['single', 'six']).default('single'), studies: z.array(z.enum(studyIds)),
  hiddenStudies: studyVisibility,
  lengths: z.record(z.enum(studyIds), z.number().int().min(1).max(500)),
  drawings: z.array(drawing).max(500),
  removedGlobal: z.array(z.string().max(128)).max(2000).default([]),
  scripts: z.array(indicatorSchema).refine(rows => new Set(rows.map(row => row.id)).size === rows.length),
  magnet: z.boolean(), strongMagnet:z.boolean().default(false), hiddenDrawings: z.boolean(), stayInDrawingMode: z.boolean().default(false), appearance: appearanceSchema,
  favoriteTools, favoritePosition, favoriteSize, favoriteCollapsed: z.boolean().default(false),
});
export type LiveWorkspaceState = z.infer<typeof workspaceSchema>;

// The working chart predates named layouts. Recover valid fields independently.
export function loadLiveWorkspace(value: unknown): LiveWorkspaceState {
  const raw = z.record(z.unknown()).safeParse(value);
  const row = raw.success ? raw.data : {};
  const fields = workspaceSchema.shape;
  const items = <T,>(list: unknown, schema: z.ZodType<T>): T[] => Array.isArray(list)
    ? list.flatMap(item => { const parsed = schema.safeParse(item); return parsed.success ? [parsed.data] : []; }) : [];
  return {
    period: fields.period.catch('1m').parse(row.period),
    chartLayout: fields.chartLayout.catch('single').parse(row.chartLayout),
    studies: Array.isArray(row.studies) ? [...new Set(items(row.studies, z.enum(studyIds)))] : ['ema20'],
    hiddenStudies: studyVisibility.catch([]).parse(row.hiddenStudies),
    lengths: fields.lengths.catch({}).parse(row.lengths),
    drawings: items(row.drawings, drawing).slice(0, 500),
    removedGlobal:fields.removedGlobal.catch([]).parse(row.removedGlobal),
    scripts: fields.scripts.catch([]).parse(row.scripts),
    magnet: row.magnet === true, strongMagnet:row.strongMagnet===true, hiddenDrawings: row.hiddenDrawings === true,
    stayInDrawingMode: fields.stayInDrawingMode.parse(row.stayInDrawingMode),
    favoriteTools: [...new Set(items(row.favoriteTools, z.enum(drawingKinds)))],
    favoritePosition: favoritePosition.catch({x: .5, y: .82}).parse(row.favoritePosition),
    favoriteCollapsed: row.favoriteCollapsed === true,
    favoriteSize: favoriteSize.catch('medium').parse(row.favoriteSize),
    appearance: appearanceSchema.catch(defaultAppearance).parse(row.appearance),
  };
}

const viewSchema = z.object({
  follow: z.boolean(),
  viewport: z.object({time: z.number().int().positive(), span: z.number().finite().positive()}).nullable(),
  rightOffset: z.number().finite(),
  priceRange: z.object({from: z.number().finite(), to: z.number().finite()}).refine(r => r.from < r.to).nullable(),
  paneSizes: z.record(z.number().finite().positive()),
});
export type ChartView = z.infer<typeof viewSchema>;
export function readChartView(value: unknown) { const result = viewSchema.safeParse(value); return result.success ? result.data : null; }
export const defaultChartView: ChartView = {follow: true, viewport: null, rightOffset: 0, priceRange: null, paneSizes: {}};
export const layoutName = z.string().trim().min(1).max(100);
const fileSchema = z.object({
  format: z.literal('xau-live-layout'), version: z.literal(1), name: layoutName,
  symbol: z.enum(marketSymbols).optional(),
  workspace: workspaceSchema, view: viewSchema, library: z.array(indicatorSchema).max(500).optional(),
});
export type LiveLayoutFile = z.infer<typeof fileSchema>;
export function makeLayoutFile(name: string, workspace: LiveWorkspaceState, view: ChartView, library?: LiveWorkspaceState['scripts'],
  symbol: MarketSymbol = defaultMarketSymbol): LiveLayoutFile {
  return fileSchema.parse({format: 'xau-live-layout', version: 1, name, workspace, view, library,
    ...(symbol === defaultMarketSymbol ? {} : {symbol})});
}
export function readLayoutFile(value: unknown): LiveLayoutFile {
  const result = fileSchema.safeParse(value);
  if (!result.success) throw Error('อ่านเลย์เอาต์ไม่ได้ กรุณาเลือกไฟล์ JSON ที่ส่งออกจาก XAUUSD Live เวอร์ชันที่รองรับ');
  return result.data;
}
