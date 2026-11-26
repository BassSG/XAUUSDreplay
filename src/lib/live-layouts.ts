import {z} from 'zod';
import {drawingTools, isStroke, strokeMax, variableDrawingsMax} from './drawing-definitions.ts';
import {periods, type Period} from './live-market.ts';
import {studyDefinitions, type LiveStudy} from './live-indicators.ts';
import {drawingSchema, indicatorSchema} from './storage.ts';

export const workspaceKey = 'xau-live-workspace-v1';
export const periodList = Object.keys(periods) as [Period, ...Period[]];
const studyIds = Object.keys(studyDefinitions) as [LiveStudy, ...LiveStudy[]];
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const appearanceSchema = z.object({
  background: color, text: color, grid: color, verticalGrid: z.boolean(), horizontalGrid: z.boolean(),
  upColor: color, downColor: color, wickUpColor: color, wickDownColor: color,
  borderUpColor: color, borderDownColor: color, wickVisible: z.boolean(), borderVisible: z.boolean(),
  pineText: z.boolean(), pineTables: z.boolean(),
});
export type ChartAppearance = z.infer<typeof appearanceSchema>;
export const defaultAppearance: ChartAppearance = {
  background: '#0d141e', text: '#93a4ba', grid: '#1a2635', verticalGrid: true, horizontalGrid: true,
  upColor: '#35c4a0', downColor: '#ef6b79', wickUpColor: '#35c4a0', wickDownColor: '#ef6b79',
  borderUpColor: '#35c4a0', borderDownColor: '#ef6b79', wickVisible: true, borderVisible: false,
  pineText: true, pineTables: true,
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
  if (isStroke(d.kind)) return count >= 2 && count <= strokeMax;
  return tool.variable ? count >= 2 && count <= variableDrawingsMax : count === tool.points.length;
}).refine(d => d.points.every(point => point.time < 8640000000000));
const workspaceSchema = z.object({
  period: z.enum(periodList), studies: z.array(z.enum(studyIds)),
  lengths: z.record(z.enum(studyIds), z.number().int().min(1).max(500)),
  drawings: z.array(drawing).max(500),
  scripts: z.array(indicatorSchema).refine(rows => new Set(rows.map(row => row.id)).size === rows.length),
  magnet: z.boolean(), hiddenDrawings: z.boolean(), appearance: appearanceSchema,
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
    studies: Array.isArray(row.studies) ? [...new Set(items(row.studies, z.enum(studyIds)))] : ['ema20'],
    lengths: fields.lengths.catch({}).parse(row.lengths),
    drawings: items(row.drawings, drawing).slice(0, 500),
    scripts: fields.scripts.catch([]).parse(row.scripts),
    magnet: row.magnet === true, hiddenDrawings: row.hiddenDrawings === true,
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
  workspace: workspaceSchema, view: viewSchema,
});
export type LiveLayoutFile = z.infer<typeof fileSchema>;
export function makeLayoutFile(name: string, workspace: LiveWorkspaceState, view: ChartView): LiveLayoutFile {
  return fileSchema.parse({format: 'xau-live-layout', version: 1, name, workspace, view});
}
export function readLayoutFile(value: unknown): LiveLayoutFile {
  const result = fileSchema.safeParse(value);
  if (!result.success) throw Error('อ่านเลย์เอาต์ไม่ได้ กรุณาเลือกไฟล์ JSON ที่ส่งออกจาก XAUUSD Live เวอร์ชันที่รองรับ');
  return result.data;
}
