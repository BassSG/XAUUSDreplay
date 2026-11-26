import type {ChartAppearance} from '../lib/live-layouts';
import {appearancePresets} from '../lib/live-layouts';

type ColorField = keyof Pick<ChartAppearance, 'background' | 'text' | 'grid' | 'upColor' | 'downColor' |
  'wickUpColor' | 'wickDownColor' | 'borderUpColor' | 'borderDownColor'>;
export default function LiveAppearance({value, onChange}: {value: ChartAppearance; onChange: (v: ChartAppearance) => void}) {
  function swatch(key: ColorField, name: string, disabled = false) {
    return <label className="chart-swatch" key={key} title={name}>
      <input aria-label={name} type="color" value={value[key]} disabled={disabled}
        onChange={event => onChange({...value, [key]: event.target.value})}/>
      <span>{value[key].toUpperCase()}</span>
    </label>;
  }
  function toggle(key: keyof Pick<ChartAppearance, 'verticalGrid' | 'horizontalGrid' | 'borderVisible' | 'wickVisible' | 'pineText' | 'pineTables'>, name: string) {
    return <label className="chart-check"><input type="checkbox" checked={value[key]}
      onChange={e => onChange({...value, [key]: e.target.checked})}/>{name}</label>;
  }
  return <div className="chart-appearance">
    <div className="chart-themes" aria-label="ชุดสีกราฟ">
      {Object.entries(appearancePresets).map(([name, preset]) => <button key={name} type="button"
        onClick={() => onChange({...preset, pineText: value.pineText, pineTables: value.pineTables})}>
        <i style={{background: preset.background, borderColor: preset.text}}/>{name}
      </button>)}
    </div>
    <fieldset><legend>พื้นที่กราฟ</legend>
      <div className="chart-color-row"><span>พื้นหลัง</span>{swatch('background', 'สีพื้นหลังกราฟ')}</div>
      <div className="chart-color-row"><span>ตัวเลขบนแกน</span>{swatch('text', 'สีตัวเลขบนแกน')}</div>
      <div className="chart-color-row"><span>เส้นตาราง</span>{swatch('grid', 'สีเส้นตาราง')}</div>
      <div className="chart-checks">{toggle('verticalGrid', 'ตารางแนวตั้ง')}{toggle('horizontalGrid', 'ตารางแนวนอน')}</div>
    </fieldset>
    <fieldset><legend>แท่งเทียน</legend>
      <div className="chart-candle-colors">
        <span/><small>ขาขึ้น</small><small>ขาลง</small>
        <span>เนื้อแท่ง</span>{swatch('upColor', 'สีเนื้อแท่งขาขึ้น')}{swatch('downColor', 'สีเนื้อแท่งขาลง')}
        {toggle('wickVisible', 'ไส้เทียน')}{swatch('wickUpColor', 'สีไส้เทียนขาขึ้น', !value.wickVisible)}{swatch('wickDownColor', 'สีไส้เทียนขาลง', !value.wickVisible)}
        {toggle('borderVisible', 'ขอบแท่ง')}{swatch('borderUpColor', 'สีขอบแท่งขาขึ้น', !value.borderVisible)}{swatch('borderDownColor', 'สีขอบแท่งขาลง', !value.borderVisible)}
      </div>
    </fieldset>
    <fieldset><legend>อินดิเคเตอร์ Pine</legend>
      <div className="chart-checks">{toggle('pineText', 'ป้ายข้อความ')}{toggle('pineTables', 'ตารางบนกราฟ')}</div>
    </fieldset>
  </div>;
}
