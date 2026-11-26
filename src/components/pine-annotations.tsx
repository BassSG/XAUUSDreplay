import type {PineDrawing} from './replay-chart';

export function pineStroke(style: unknown) {
  return String(style ?? '').split('_').at(-1);
}
export function pineDash(style: unknown) {
  const pattern = pineStroke(style);
  return pattern === 'dashed' || pattern === 'd' ? '6 4' : pattern === 'dotted' || pattern === 'o' ? '1 3' : undefined;
}
const px: Record<string, number> = {tiny: 8, small: 10, normal: 12, large: 16, huge: 20};
function fontSize(size: unknown) { return px[String(size)] ?? (Number(size) > 0 ? Number(size) : 12); }
const font = "'Segoe UI',sans-serif";
let measure: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string[], size: number) {
  measure ??= document.createElement('canvas').getContext('2d');
  if (measure) measure.font = size + 'px ' + font;
  return Math.ceil(Math.max(...text.map(line => measure?.measureText(line).width ?? line.length * size * .55)));
}

export function PineBox({d,left,right,top,bottom,paneWidth,showText}: {
  d: PineDrawing; left: number; right: number; top: number; bottom: number; paneWidth: number; showText: boolean;
}) {
  const x = Math.min(left,right), y = Math.min(top,bottom), x2 = Math.max(left,right), y2 = Math.max(top,bottom);
  const extend = String(d.extend), start = ['left','both','l','b'].includes(extend) ? Math.min(0,x) : x;
  const end = ['right','both','r','b'].includes(extend) ? Math.max(paneWidth,x2) : x2;
  const align = d.text_halign, valign = d.text_valign, size = fontSize(d.text_size), lineHeight = size * 1.2;
  const lines = String(d.text ?? '').split('\n');
  const tx = align === 'right' ? x2-3 : align === 'left' ? x+3 : (x+x2)/2;
  const ty = valign === 'top' ? y+2+size/2 : valign === 'bottom' ? y2-2-size/2-(lines.length-1)*lineHeight : (y+y2-(lines.length-1)*lineHeight)/2;
  return <g className="pine-zone"><rect x={start} y={y} width={Math.max(0,end-start)} height={y2-y}
    fill={d.bgcolor || 'transparent'} stroke={d.border_color || 'transparent'}
    strokeWidth={d.border_width ?? 1} strokeDasharray={pineDash(d.border_style)}/>
    {showText && d.text && <text x={tx} y={ty} textAnchor={align === 'right' ? 'end' : align === 'left' ? 'start' : 'middle'}
      dominantBaseline="central" fontSize={size} fontFamily={font} fill={d.text_color || '#dbe4ef'}>
      {lines.map((line,i)=><tspan key={i} x={tx} dy={i ? lineHeight : 0}>{line}</tspan>)}</text>}</g>;
}

export function PineLabel({d,x,y}: {d: PineDrawing; x: number; y: number}) {
  const lines = String(d.text ?? '').split('\n'), size = fontSize(d.size), step = size * 1.25;
  const width = textWidth(lines,size) + 8, height = lines.length * step + 4, tip = 4;
  const style = String(d.style ?? 'style_label_down').replace(/^style_(label_)?/,'');
  let left = x-width/2, top = y-height/2, pointer = '';
  if (style === 'left') { left = x+tip; pointer = `${x},${y} ${left+1},${y-tip} ${left+1},${y+tip}`; }
  else if (style === 'right') { left = x-width-tip; pointer = `${x},${y} ${x-tip-1},${y-tip} ${x-tip-1},${y+tip}`; }
  else if (['up','down','upper_left','upper_right','lower_left','lower_right'].includes(style)) {
    const below = style === 'up' || style.startsWith('upper');
    if (style.endsWith('_left')) left = x;
    if (style.endsWith('_right')) left = x-width;
    top = below ? y+tip : y-height-tip;
    const base = below ? top+1 : top+height-1, mid = Math.max(left+tip,Math.min(x,left+width-tip));
    pointer = `${x},${y} ${mid-tip},${base} ${mid+tip},${base}`;
  }
  const textX = d.textalign === 'left' ? left+4 : d.textalign === 'right' ? left+width-4 : left+width/2;
  return <g className="pine-caption" fill={d.color || 'transparent'}>
    {d.tooltip && <title>{d.tooltip}</title>}
    {style !== 'none' && <><rect x={left} y={top} width={width} height={height} rx={2}/>{pointer && <polygon points={pointer}/>}</>}
    <text x={textX} y={top+2+step/2} textAnchor={d.textalign === 'left'?'start':d.textalign === 'right'?'end':'middle'}
      dominantBaseline="central" fill={d.textcolor || '#fff'} fontSize={size} fontFamily={font}>
      {lines.map((line,i)=><tspan key={i} x={textX} dy={i ? step : 0}>{line}</tspan>)}
    </text></g>;
}
