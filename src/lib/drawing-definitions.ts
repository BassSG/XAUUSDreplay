type Tool = {
  name: string;
  points: readonly string[];
  help: string;
  text?: boolean;
  variable?: boolean;
};

function tool(name: string, help: string, points: string[], options: Pick<Tool, 'text' | 'variable'> = {}): Tool {
  return {name, help, points, ...options};
}

export const drawingTools = {
  trend: tool('เส้นแนวโน้ม', 'เชื่อมสองจุดสูงหรือต่ำบนกราฟ', ['ต้นเส้น', 'ปลายเส้น']),
  ray: tool('เส้นรังสี', 'ลากแนวจากจุดต้นผ่านจุดที่สองไปถึงขอบ', ['จุดเริ่ม', 'ทิศทาง']),
  extended: tool('เส้นยืดสองด้าน', 'ต่อแนวผ่านสองจุดออกไปทั้งสองด้าน', ['จุดแรก', 'จุดที่สอง']),
  arrow: tool('ลูกศร', 'ชี้จากจุดต้นไปที่จุดปลาย', ['หางลูกศร', 'หัวลูกศร']),
  info: tool('เส้นพร้อมข้อมูล', 'ดูการเปลี่ยนแปลงราคา เปอร์เซ็นต์ และจำนวนแท่ง', ['จุดเริ่มวัด', 'จุดสิ้นสุด']),
  hline: tool('เส้นแนวนอน', 'ทำเครื่องหมายระดับราคาเดียวตลอดกราฟ', ['ระดับราคา']),
  hray: tool('รังสีแนวนอน', 'ขีดระดับราคาไปทางขวาจากเวลาเริ่ม', ['ราคาและเวลาเริ่ม']),
  vline: tool('เส้นแนวตั้ง', 'ทำเครื่องหมายเวลาเดียวตลอดแกนราคา', ['เวลา']),
  cross: tool('เส้นกากบาท', 'ตรึงเวลาและราคาที่จุดตัดเดียวกัน', ['จุดตัด']),
  channel: tool('ช่องขนาน', 'วางเส้นฐานสองจุด แล้วกำหนดระยะของขอบอีกด้าน', ['ต้นเส้นฐาน', 'ปลายเส้นฐาน', 'ขอบด้านตรงข้าม']),
  regression: tool('ช่องถดถอยเชิงเส้น', 'ใช้ราคาปิดในช่วงที่เลือกสร้างเส้นถดถอยและกรอบ ±2 ส่วนเบี่ยงเบนมาตรฐาน', ['ต้นช่วง', 'ท้ายช่วง']),
  pitchfork: tool('Pitchfork', 'สร้างเส้นมัธยฐานจากจุดแรกผ่านกึ่งกลางสองจุดหลัง', ['จุดตั้งต้น', 'ขอบแรก', 'ขอบที่สอง']),
  fib: tool('Fibonacci Retracement', 'หาระดับย่อจากระยะราคาของสองจุด', ['ต้นขาราคา', 'ปลายขาราคา']),
  fibExtension: tool('Fibonacci Extension', 'คูณช่วงราคาจากสองจุดแรก แล้วฉายระดับออกจากจุดที่สาม', ['ต้นขาราคา', 'ปลายขาราคา', 'จุดเริ่มฉาย']),
  fibChannel: tool('Fibonacci Channel', 'กระจายระดับ Fibonacci จากระยะระหว่างเส้นขนาน', ['ต้นเส้นฐาน', 'ปลายเส้นฐาน', 'ขอบ 100%']),
  fibTime: tool('Fibonacci Time Zones', 'ทำเครื่องหมายระยะเวลาเป็นจำนวนแท่งตามลำดับ Fibonacci', ['เวลาเริ่ม', 'ระยะหนึ่งช่วง']),
  fibFan: tool('Fibonacci Fan', 'ลากรังสีจากจุดแรกผ่านระดับ Fibonacci ที่เวลาจุดที่สอง', ['ต้นพัด', 'ระยะเวลาและราคา']),
  gannBox: tool('Gann Box', 'แบ่งช่วงราคาและเวลาเป็นแปดส่วนเท่ากัน', ['มุมแรก', 'มุมตรงข้าม']),
  gannFan: tool('Gann Fan', 'วางสเกล 1×1 เองด้วยสองจุด แล้วฉายรังสีตามอัตราส่วนราคาและเวลา', ['ต้นพัด', 'จุดกำหนดสเกล 1×1']),
  rect: tool('สี่เหลี่ยม / โซนราคา', 'ทำกรอบครอบช่วงราคาและเวลา', ['มุมแรก', 'มุมตรงข้าม']),
  rotated: tool('สี่เหลี่ยมเอียง', 'วางขอบแรกสองจุดและกำหนดความกว้างจากจุดที่สาม', ['ต้นขอบ', 'ปลายขอบ', 'ความกว้าง']),
  circle: tool('วงกลม', 'กำหนดศูนย์กลางและรัศมี', ['ศูนย์กลาง', 'ขอบวงกลม']),
  ellipse: tool('วงรี', 'กำหนดกรอบวงรีด้วยมุมตรงข้าม', ['มุมแรก', 'มุมตรงข้าม']),
  triangle: tool('สามเหลี่ยม', 'เชื่อมสามมุมเป็นรูปสามเหลี่ยม', ['มุมแรก', 'มุมที่สอง', 'มุมที่สาม']),
  polyline: tool('เส้นหลายจุด', 'ยืนยันทีละจุด แล้วกดจบเส้นเมื่อได้รูปที่ต้องการ', ['จุดบนเส้น'], {variable: true}),
  brush: tool('พู่กัน', 'ลากนิ้วหรือเมาส์บนกราฟ ตรวจเส้นตัวอย่าง แล้วกดยืนยัน', ['เส้นพู่กัน']),
  highlighter: tool('ไฮไลต์', 'ลากเพื่อเน้นพื้นที่ด้วยเส้นโปร่ง แล้วกดยืนยัน', ['เส้นไฮไลต์']),
  curve: tool('เส้นโค้ง', 'เลือกต้นและปลาย แล้ววางจุดควบคุมความโค้ง', ['ต้นเส้น', 'ปลายเส้น', 'จุดควบคุม']),
  doubleCurve: tool('เส้นโค้งสองด้าน', 'วางต้น ปลาย และจุดควบคุมโค้งสองจุด', ['ต้นเส้น', 'ปลายเส้น', 'จุดควบคุมฝั่งต้น', 'จุดควบคุมฝั่งปลาย']),
  arc: tool('ส่วนโค้ง', 'เลือกปลายสองด้านและจุดบนช่วงโค้ง', ['ต้นส่วนโค้ง', 'ปลายส่วนโค้ง', 'จุดบนส่วนโค้ง']),
  abcd: tool('รูปแบบ ABCD', 'วางจุด A ถึง D เพื่อบันทึกโครงสร้างราคา', ['A', 'B', 'C', 'D']),
  xabcd: tool('รูปแบบ XABCD', 'วางจุด X ถึง D ตามรูปแบบที่อ่านจากกราฟ', ['X', 'A', 'B', 'C', 'D']),
  headShoulders: tool('Head & Shoulders', 'ทำเครื่องหมายไหล่ ศีรษะ และเส้นคอด้วยจุดที่เลือกเอง', ['ไหล่ซ้าย', 'คอซ้าย', 'หัว', 'คอขวา', 'ไหล่ขวา']),
  elliott: tool('Elliott Impulse', 'ทำเครื่องหมายต้นคลื่นและคลื่น 1 ถึง 5 ด้วยตนเอง', ['0', '1', '2', '3', '4', '5']),
  elliottABC: tool('Elliott Correction', 'ทำเครื่องหมายจุดเริ่มและคลื่น A, B, C ด้วยตนเอง', ['เริ่ม', 'A', 'B', 'C']),
  cycle: tool('รอบเวลา', 'ทำเครื่องหมายรอบตามจำนวนแท่งระหว่างสองจุด', ['เวลาเริ่ม', 'เวลาจบรอบแรก']),
  ruler: tool('ช่วงราคาและเวลา', 'วัดราคา เปอร์เซ็นต์ เวลา และจำนวนแท่งระหว่างสองจุด', ['จุดเริ่มวัด', 'จุดสิ้นสุด']),
  priceRange: tool('ช่วงราคา', 'วัดผลต่างราคาและเปอร์เซ็นต์', ['ราคาแรก', 'ราคาที่สอง']),
  dateRange: tool('ช่วงเวลา', 'วัดเวลาที่ผ่านไปและจำนวนแท่ง', ['เวลาเริ่ม', 'เวลาสิ้นสุด']),
  position: tool('กรอบช่วงราคา', 'ขีดกรอบและดูผลต่างของสองจุด', ['จุดเริ่ม', 'จุดสิ้นสุด']),
  long: tool('Long Position', 'กำหนดราคาเข้า เป้าหมายเหนือราคาเข้า และ Stop ใต้ราคาเข้า เพื่อดู Reward/Risk', ['Entry', 'Take Profit', 'Stop Loss']),
  short: tool('Short Position', 'กำหนดราคาเข้า เป้าหมายใต้ราคาเข้า และ Stop เหนือราคาเข้า เพื่อดู Reward/Risk', ['Entry', 'Take Profit', 'Stop Loss']),
  vwap: tool('Anchored VWAP (Tick Volume)', 'ใช้ราคาเฉลี่ย HLC ถ่วงด้วยจำนวน Tick จากแท่งเริ่มที่เลือก', ['แท่งที่เริ่มคำนวณ']),
  text: tool('ข้อความ', 'วางข้อความไว้ที่ราคาและเวลา แก้ข้อความได้เมื่อเลือกวัตถุ', ['ตำแหน่งข้อความ'], {text: true}),
  note: tool('ป้ายบันทึก', 'ปักข้อความพร้อมกรอบที่ตำแหน่งสำคัญ', ['ตำแหน่งป้าย'], {text: true}),
  priceLabel: tool('ป้ายราคา', 'แสดงระดับราคาตรงจุดที่เลือก', ['ตำแหน่งราคา']),
  callout: tool('คำอธิบายพร้อมเส้นชี้', 'เลือกจุดที่จะชี้และตำแหน่งข้อความแยกกัน', ['จุดที่ชี้', 'ตำแหน่งข้อความ'], {text: true}),
  flag: tool('ธง', 'ปักธงไว้บนแท่งหรือเหตุการณ์ที่ต้องการจำ', ['ตำแหน่งธง']),
  markUp: tool('ลูกศรขึ้น', 'ทำเครื่องหมายขึ้นที่ตำแหน่งที่เลือก', ['ตำแหน่งลูกศร']),
  markDown: tool('ลูกศรลง', 'ทำเครื่องหมายลงที่ตำแหน่งที่เลือก', ['ตำแหน่งลูกศร']),
} satisfies Record<string, Tool>;

export type DrawingKind = keyof typeof drawingTools;
export const drawingKinds = Object.keys(drawingTools) as [DrawingKind, ...DrawingKind[]];
export const isStroke = (kind: DrawingKind) => kind === 'brush' || kind === 'highlighter';
export const isLabelBox = (kind: DrawingKind) => kind === 'rect' || kind === 'rotated' || kind === 'gannBox' || kind === 'position';
export const variableDrawingsMax = 64;
export const strokeMax = 160;

export const drawingGroups = {
  lines: {name: 'เส้นและลูกศร', tools: ['trend', 'hline', 'hray', 'vline', 'cross', 'ray', 'extended', 'arrow', 'info']},
  channels: {name: 'ช่องและ Pitchfork', tools: ['channel', 'regression', 'pitchfork']},
  levels: {name: 'Fibonacci และ Gann', tools: ['fib', 'fibExtension', 'fibChannel', 'fibTime', 'fibFan', 'gannBox', 'gannFan']},
  shapes: {name: 'รูปทรงและพู่กัน', tools: ['rect', 'rotated', 'circle', 'ellipse', 'triangle', 'polyline', 'brush', 'highlighter', 'curve', 'doubleCurve', 'arc']},
  patterns: {name: 'รูปแบบราคาและรอบเวลา', tools: ['abcd', 'xabcd', 'headShoulders', 'elliott', 'elliottABC', 'cycle']},
  measure: {name: 'การวัดและสถานะจำลอง', tools: ['ruler', 'priceRange', 'dateRange', 'position', 'long', 'short', 'vwap']},
  annotations: {name: 'ป้ายและข้อความ', tools: ['text', 'note', 'priceLabel', 'callout', 'flag', 'markUp', 'markDown']},
} satisfies Record<string, {name: string; tools: DrawingKind[]}>;
