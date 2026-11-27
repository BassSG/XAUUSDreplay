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

function fitLine(line: string, width: number, size: number) {
  if (textWidth([line],size) <= width) return line;
  if (textWidth(['…'],size) > width) return '';
  const chars = Array.from(line);
  let from = 0, to = chars.length;
  while (from < to) {
    const middle = Math.ceil((from + to) / 2);
    if (textWidth([chars.slice(0,middle).join('') + '…'],size) <= width) from = middle;
    else to = middle - 1;
  }
  return chars.slice(0,from).join('').trimEnd() + '…';
}

export function PineBox({d,left,right,top,bottom,paneWidth,showText,compact=false}: {
  d: PineDrawing; left: number; right: number; top: number; bottom: number; paneWidth: number; showText: boolean; compact?: boolean;
}) {
  const x = Math.min(left,right), y = Math.min(top,bottom), x2 = Math.max(left,right), y2 = Math.max(top,bottom);
  const extend = String(d.extend), start = ['left','both','l','b'].includes(extend) ? Math.min(0,x) : x;
  const end = ['right','both','r','b'].includes(extend) ? Math.max(paneWidth,x2) : x2;
  const align = d.text_halign, valign = d.text_valign;
  const size = compact ? Math.min(11,fontSize(d.text_size)) : fontSize(d.text_size), lineHeight = size * 1.2;
  const caption = String(d.text ?? '');
  const captionLeft = compact ? Math.max(0,x) : x;
  const captionRight = compact ? Math.min(paneWidth,x2) : x2;
  const available = captionRight - captionLeft - 6;
  const lines = compact ? [fitLine(caption.replace(/\s*\n\s*/g,' · '),available,size)] : caption.split('\n');
  const tx = align === 'right' ? captionRight-3 : align === 'left' ? captionLeft+3 : (captionLeft+captionRight)/2;
  const ty = valign === 'top' ? y+2+size/2 : valign === 'bottom' ? y2-2-size/2-(lines.length-1)*lineHeight : (y+y2-(lines.length-1)*lineHeight)/2;
  return <g className="pine-zone"><rect x={start} y={y} width={Math.max(0,end-start)} height={y2-y}
    fill={d.bgcolor || 'transparent'} stroke={d.border_color || 'transparent'}
    strokeWidth={d.border_width ?? 1} strokeDasharray={pineDash(d.border_style)}/>
    {showText && compact && caption && <title>{caption}</title>}
    {showText && lines.some(Boolean) && <text x={tx} y={ty} textAnchor={align === 'right' ? 'end' : align === 'left' ? 'start' : 'middle'}
      dominantBaseline="central" fontSize={size} fontFamily={font} fill={d.text_color || '#dbe4ef'}>
      {lines.map((line,i)=><tspan key={i} x={tx} dy={i ? lineHeight : 0}>{line}</tspan>)}</text>}</g>;
}

export function PineLabel({d,x,y,bounds}: {d: PineDrawing; x: number; y: number; bounds?: {width:number;height:number}}) {
  const caption = String(d.text ?? '');
  const sourceLines = caption.split('\n');
  const size = bounds ? Math.min(12,fontSize(d.size)) : fontSize(d.size);
  const maxText = bounds ? Math.min(180,bounds.width - 16) : Infinity;
  const lines = bounds ? [fitLine(sourceLines.join(' · '),maxText,size)] : sourceLines;
  const step = size * 1.25, tip = 4, margin = 3;
  const width = textWidth(lines,size) + 8, height = lines.length * step + 4;
  let style = String(d.style ?? 'style_label_down').replace(/^style_(label_)?/,'');
  if (bounds) {
    // A near-right projection can keep its tag by flipping it inward. Leave
    // off-screen swing marks unmounted when the user pans away from them.
    const projected = style === 'left' && x <= bounds.width * 1.25;
    if (x < 0 || (x > bounds.width && !projected) || y < 0 || y > bounds.height) return null;
    x = Math.min(x,bounds.width - margin);
    if (style === 'left' && x + tip + width > bounds.width - margin) style = 'right';
    else if (style === 'right' && x - width - tip < margin) style = 'left';
  }
  const isVertical = ['up','down','upper_left','upper_right','lower_left','lower_right'].includes(style);
  const below = style === 'up' || style.startsWith('upper');
  let left = x-width/2, top = y-height/2;
  if (style === 'left') left = x+tip;
  else if (style === 'right') left = x-width-tip;
  else if (isVertical) {
    if (style.endsWith('_left')) left = x;
    if (style.endsWith('_right')) left = x-width;
    top = below ? y+tip : y-height-tip;
  }
  if (bounds) {
    left = Math.max(margin,Math.min(left,bounds.width-width-margin));
    top = Math.max(margin,Math.min(top,bounds.height-height-margin));
  }
  let pointer = '';
  const centreY = top + height/2;
  if (style === 'left') pointer = `${x},${y} ${left+1},${centreY-tip} ${left+1},${centreY+tip}`;
  else if (style === 'right') pointer = `${x},${y} ${left+width-1},${centreY-tip} ${left+width-1},${centreY+tip}`;
  else if (isVertical) {
    const base = below ? top+1 : top+height-1, mid = Math.max(left+tip,Math.min(x,left+width-tip));
    pointer = `${x},${y} ${mid-tip},${base} ${mid+tip},${base}`;
  }
  const textX = d.textalign === 'left' ? left+4 : d.textalign === 'right' ? left+width-4 : left+width/2;
  const title = d.tooltip || (bounds && caption);
  return <g className="pine-caption" fill={d.color || 'transparent'}>
    {title && <title>{title}</title>}
    {style !== 'none' && <><rect x={left} y={top} width={width} height={height} rx={2}/>{pointer && <polygon points={pointer}/>}</>}
    <text x={textX} y={top+2+step/2} textAnchor={d.textalign === 'left'?'start':d.textalign === 'right'?'end':'middle'}
      dominantBaseline="central" fill={d.textcolor || '#fff'} fontSize={size} fontFamily={font}>
      {lines.map((line,i)=><tspan key={i} x={textX} dy={i ? step : 0}>{line}</tspan>)}
    </text></g>;
}
