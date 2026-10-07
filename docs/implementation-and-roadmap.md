# XAU Replay: บันทึกการปรับปรุงและแผนต่อยอด

วันที่: 7 ตุลาคม 2026 · ฐานที่ตรวจ: origin/main 889b956 · สาขาทำงาน: codex/replay-complete

## ปัญหาที่ตรวจพบและสิ่งที่แก้แล้ว

| ปัญหา | การแก้และหลักฐาน |
| --- | --- |
| สอง builtin ถูกตัด source: All Indy 75,600 / Fibo 51,828 ตัวอักษร | คืนต้นฉบับครบ 212,346 / 103,937 ตัวอักษร; hash ตรงไฟล์แนบ; ใช้ URL ใหม่ป้องกัน service worker คืนไฟล์เก่า |
| tests ยืนยันเพียงไม่มี error แม้ไม่มี output | ตรวจจำนวน plot, ค่าตัวเลข, force_overlay, Dashboard ที่เปิดจริง, metadata inputs และ 17 ช่อง Zone Bridge |
| main_period เปลี่ยนตาม secondary TF | คง TF กราฟหลักใน secondary context; regression ใช้ฟังก์ชันที่เลือกคนละ security branch |
| UDT array na กลายเป็น 0, copy() คืนค่าตอนสร้าง | adapter แก้พฤติกรรม PineTS 0.11 โดยไม่แก้ไฟล์ต้นฉบับ; มี guard ของ packet ตอน warmup |
| security slice ไม่เก็บ expression ของ dynamic call ในบาง scope | ใช้ main_period ที่ถูกต้อง และจับคู่ expression suffix เฉพาะกรณีเดียวที่ไม่กำกวมใน TF เดียวกัน |
| คำนวณสคริปต์ใหญ่ใหม่ทุกแท่ง | เก็บ runtime; snapshot คืน array, UDT, drawing, TA และ request parameters ก่อนแก้ forming candle; จัดการ secondary ที่ไม่มี snapshot และ plot time ซ้ำ |
| ผลจาก cursor ก่อนหน้าติดบนจอหลัง rewind | ผูกผลกับ session/TF/cursor/OHLC/source/inputs; ซ่อนผลจน key ตรง; แคชผลล่าสุด 8 จุดภายในงบจำนวนจุดข้อมูล |
| แท่ง HTF ที่เก็บไว้เผย high/low ในอนาคต | ตัดแท่งที่ยังไม่ปิดออก และประกอบจากแท่งย่อยที่เปิดแล้ว; เติมต้นสัปดาห์/เดือนจาก coarse candles ที่ปิดแล้ว |
| gzip ที่ browser ถอดให้แล้วทำให้ตรวจ hash ไม่ผ่าน | catalog-v2 เก็บ compressed และ decoded SHA-256; ตรวจทั้งสองแบบ; เก็บ catalog เดิมสำหรับ client เก่า |
| warmup เลือกตามระยะเวลา แทนจำนวนแท่งจริง | โหลด 2,500 แท่งก่อนวันที่เลือกข้ามวันหยุด; จัด cursor ตรงแท่งเริ่มจริง; เก็บ windowStart หลัง prepend |
| ไม่มี Pine input editor / import source เต็ม | นำเข้า .pine/.txt, วาง source, ค้นหา inputs ตามกลุ่ม, เพิ่มหลาย study, persist/backup |
| ลาก SL แล้ว TP ในแท่งเดียวกันทำให้ค่าก่อนหน้าหาย | รวมคำสั่งของ Position/Pending เดียวกันในแท่งนั้น; มีผลแท่งถัดไป; ไม่เปลี่ยน initial risk |
| Pending gap / TP ที่อาจแตะก่อน Entry | ปฏิเสธ gap ที่ผิด protection; TP ของ limit ระหว่างแท่งต้องมีหลักฐานจาก close หรือรอแท่งต่อไป |
| Dashboard ของหลายตัวทับกัน, กราฟสูงไม่หยุด | ซ้อน Dashboard ตามตำแหน่งและยุบได้; ซ่อนตารางว่าง; รักษา pane/series และเลื่อนภายในพื้นที่กราฟ |
| backup child ชี้ parent คนละสำเนา | remap parent ของทุกรอบที่นำเข้า; regression กรณี parent ขัดแย้งแต่ child ยังไม่มีในเครื่อง |

## สถาปัตยกรรมที่ใช้งาน

React + Vite PWA → IndexedDB เก็บรอบ/ข้อมูล → Replay engine คำนวณจากคำสั่งตามเวลา → Lightweight Charts แสดงเฉพาะส่วนที่เปิดแล้ว

Pine เป็น Web Worker แยกจาก UI ใช้ source เต็ม + compatibility adapter ของ PineTS 0.11.0 โหลดข้อมูล MTF ตามจุด Replay และส่งเฉพาะผลที่แสดงได้กลับ UI ไม่มีคำสั่งซื้อขายจริง ไม่มีการส่ง source หรือสมุดบันทึกไปประมวลผลบน server

ชุดราคา immutable 6 timeframe รวม 345,996 แท่ง ไม่ได้มี 1m ย้อนถึง 2021: 1h/4h เริ่ม 2021, 15m เริ่ม 2022, 5m เริ่ม 2025 และ 1m เริ่มมิถุนายน 2026 แอปเลือกชุดที่รองรับวัน/TF นั้นและแจ้งเมื่อจำเป็นต้องใช้ timeframe ใหญ่ขึ้น

## เกณฑ์ตรวจรับ

- เพิ่มสอง source ฉบับเต็มพร้อมกัน; แสดง Stochastic/RSI ใน pane แยกจากราคา; แสดง zones/Fibonacci บนราคา; Fibo แจ้งเชื่อม Zone Bridge
- เปิด Dashboard ผ่าน inputs และเห็นข้อมูลจริง ไม่ใช่เพียง object ตารางที่ว่าง
- เปิดหลาย study, ปิด/เปิด/แก้ inputs, reload แล้วอยู่ครบ; storage test ครอบคลุม 12 ตัว
- เปลี่ยนวัน, ข้ามสุดช่วงไปข้อมูลเก่า, reload แล้ว window/cursor/commands ไม่เปลี่ยนความหมาย
- ลาก SL/TP ของ draft แล้วราคา/RR เปลี่ยน; ลาก Position/Pending แล้วแสดงคำสั่งรอและใช้แท่งถัดไป; initial R คงเดิม
- forming HTF / lower TF / calendar month / broker DST / gzip ทั้งสองแบบ / integrity / backup ผ่าน regression
- npm test และ npm run build ผ่าน; GitHub Actions deploy ผ่าน; เปิดหน้า GitHub Pages และตรวจ assets ของ release ใหม่

## ขอบเขตที่ยังต้องรู้

Pine runtime เป็น beta ไม่มีการรับรองว่าเท่ากับ TradingView ทุก input/ภาพ/ตัวเลข การตรวจครั้งนี้ยืนยัน source ครบ, output ทำงานและกติกา Replay ของแอป ยังไม่ได้ทำ golden comparison กับผล TradingView โดยตรง

รองรับ indicator() สำหรับการแสดงผล ยังไม่เชื่อม strategy() เป็นคำสั่งใน engine ไม่รองรับ Pine library imports หรือ source ที่ล็อกอยู่บน TradingView ภาพ custom candles/bars/background, offset และวัตถุใน oscillator บางชนิดยังไม่ครบ

ไม่มีบัญชี/ซิงก์ cloud: แต่ละ browser/device เก็บรอบของตน ใช้ JSON backup ย้ายข้ามเครื่องได้ ข้อมูลที่ไม่เคยโหลดต้องออนไลน์ โหลด cold ของสคริปต์ใหญ่ยังมีเวลารอ โดยเฉพาะบนโทรศัพท์; ไม่มีเพดานจำนวน study แต่มีขนาด source/backup และ timeout เพื่อป้องกันเครื่องค้าง

## แผนต่อยอดหลังรุ่นนี้

1. **ความตรงกับ TradingView:** สร้าง reference export จาก source เดียวกัน/ราคาเดียวกัน/inputs เดียวกัน ใน 1m, 5m, 15m, 1h, 4h, 1D; ตรวจ oscillator, packet timestamp/checksum, zones, Hero TF และ drawing anchors; จัด golden fixtures ก่อนเปลี่ยน runtime
2. **Pine rendering:** รองรับ plot fills/offset, styles และ primitives ใน oscillator; preview errors พร้อมเลขบรรทัด; source mapping และรายการฟีเจอร์ที่ compile ได้แต่ยังวาดไม่ได้
3. **ลด cold load:** ทำ call-expression execution ที่ไม่รันส่วนอื่นของ secondary; checkpoints ที่ผ่าน golden tests; วัดบน iPad/iPhone จริงพร้อม peak memory; ไม่ลดข้อมูล warmup เงียบ ๆ เพื่อให้เร็ว
4. **เครื่องมือวาด:** ลากจุดวัตถุ, เลือก/ล็อก/เปลี่ยนสี/ความหนา, favorites, snap levels, chart layouts และหลายกราฟที่ใช้ replay clock เดียวกัน
5. **การฝึกและ Journal:** บันทึก setup/tag, equity curve แบบละเอียด, expectancy/profit factor, daily/weekly review, screenshot แนบ trade และแบบฝึก blind replay
6. **ข้อมูลและการย้ายเครื่อง:** นำเข้า tick หรือ lower-TF ที่ครอบคลุมมากขึ้นเพื่อลด intrabar ambiguity; ถ้าต้องการ cloud sync ให้ทำแยกโดยมี auth, data migration และ conflict resolution

แต่ละขั้นต่อยอดต้องมีเกณฑ์ตรวจรับของผลจริง ไม่ใช้เพียง compile ผ่านหรือหน้าจอมีปุ่ม
