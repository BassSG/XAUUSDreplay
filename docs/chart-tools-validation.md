# เครื่องมือวาดและ Replay ความเร็วสูง

## ปัญหาและการแก้

ระบบเดิมเก็บจุดแรกใน ref โดยไม่ยกเลิกเมื่อเปลี่ยนเครื่องมือ ไม่มี preview และ SVG รับ pointer ไม่ได้ จึงเลือก/ย้ายวัตถุไม่ได้ `coordinateToTime()` คืน null ในพื้นที่ว่าง และ `timeToCoordinate()` คืน null เมื่อจุดอ้างอิงอยู่นอกชุดที่วาด ทำให้วาดแล้วไม่เห็น Ray ถูกยืดไปขวาเสมอ นอกจากนี้ `follow || playing` กับ `scrollToRealTime()` ทำให้ Play บังคับกราฟไปขอบขวา

แยก ChartDrawings ออกจาก Pine overlays ใช้ logical projection จาก timestamps ที่เปิดแล้ว มี preview, hit area 18px, จุดจับ 26px, pointer capture, ยกเลิกเมื่อสลับเครื่องมือ, ลาก preview แล้ว commit ครั้งเดียว, ล็อก/สี/แก้ Text, keyboard Undo/Redo/Delete และจำวัตถุผ่าน session schema เดิม จุดจับ TP/SL หลบระหว่างวาดและเลือกแก้วัตถุ

มุมมอง Replay เก็บ logical range ก่อนเปลี่ยนข้อมูลและคืน range ที่ชดเชย window offset โหมด follow รักษาตำแหน่งแท่งล่าสุดในจอ โหมดอิสระยึดเวลาเดิม ไม่มี forced scroll เมื่อ Play ปุ่มแท่งล่าสุดเว้นที่ว่างประมาณ 28% ทางขวา

เพิ่ม 30×/40×/50×/100× ใช้ batch เริ่ม 3/4/5/10 แท่ง และปรับตามเวลาคำนวณ สูงสุดเทียบเวลา replay ที่ขอ 0.5 วินาทีต่อรอบ (100× สูงสุด 50 แท่ง) Worker updateTail คำนวณแท่งกลางทุกแท่งและคืนผลก่อน commit cursor; order engine ยังประเมินทุกแท่ง ความเร็วจริงแสดงแยกจากค่าที่เลือก Pause ยกเลิกการ commit ที่ค้างอยู่

Runtime ยังเก็บ history เต็มสำหรับ TA/MTF/Zone Bridge แต่ส่ง plot/shape เฉพาะ 2,000 แท่งที่ chart วาด ลด structured-clone และการ map ข้อมูลซ้ำ ตรวจ prefix ด้วยค่า OHLCV แทน JSON stringify แต่ละแท่ง Cache แยกตาม output limit

## การตรวจ

- Regression 71 ข้อผ่าน รวม logical/time round-trip ข้าม market gap, ย้ายวัตถุรักษาช่วงแท่ง, locked object, ray ซ้าย/ขวา/แนวตั้ง, batch limits และ range เมื่อ window เลื่อน/ย้อน
- EMA/RSI/array count/HTF ใน batch 10 แท่งและ output window ตรงกับ cold calculation โดย Count ยืนยันว่าไม่ได้ข้ามแท่งกลาง
- ทั้งสอง source เต็มทดสอบ incremental เดินข้าม forming candles และ Zone Bridge เปรียบเทียบ plots/tables กับ cold calculation
- Browser localhost: วาดทั้ง 9 ชนิด, preview, เปลี่ยน Trend → Ray ไม่เก็บจุดแรกเก่า, H-Line ใน whitespace, ลากปลายเส้น/ทั้งเส้น, Undo, Delete/keyboard Undo, ล็อก Text, แก้ Text, Hide/Show
- Browser localhost ที่ 100× ก่อนปรับ adaptive batch: ทั้งสองตัวเปิดบน 15m/base 1m, ตรวจ 30 frame ไม่พบ overlay ว่างหรือสถานะ loading; x ของ V-Line คงเดิมทุก frame ในโหมดอิสระ (ไม่ถูกบังคับไปขวา)
- หลังปรับ adaptive batch: จาก cursor 2659 → 3169 (510 แท่ง) ในประมาณ 12.7 วินาที รวมเวลาเก็บภาพ/กด Pause (~40.2×; ค่า frame สุดท้าย 42.0×) จากเดิม frame ประมาณ 22.3× ตรวจ 40 frame: overlay ว่าง 0, loading 0, V-Line x=314.15873015873024 ทุก frame; batch ที่สังเกต 10 และ 50 แท่ง
- Regression full All Indy + EBW-Fibo เพิ่มการเดินหน้า 2210 → 2260 (50 แท่ง) ยังใช้ incremental ทั้งคู่ และ plots/tables ตรง cold calculation; targeted tests ทั้ง full sources และ windowed worker ผ่าน 2/2 หลังปรับ batch
- Responsive 390px: document width และ scroll width 390px เท่ากัน เครื่องมือเลื่อนใน toolbar เอง; ยังไม่ได้ตรวจ touch gesture บนอุปกรณ์ iOS/Android จริง เพราะ in-app browser ไม่รองรับ Input.dispatchTouchEvent
- PNG export ตรวจจากไฟล์ที่ดาวน์โหลดจริง: เส้นทั้ง 9 ชนิดและข้อความปรากฏตรงกับกราฟ รวม Pine oscillator/โซน โดยไม่ยืดรูปวาดข้าม pane และเอา hit area/จุดจับออกก่อน export; ใช้สัดส่วน canvas pixel ต่อ CSS pixel สำหรับหน้าจอความละเอียดสูง

ความเร็ว 100× เป็นเป้าหมาย ไม่ใช่การรับประกันทุกสคริปต์/อุปกรณ์ สคริปต์ใหญ่โหลดครั้งแรกและเมื่อเปลี่ยน inputs/TF ยังต้องคำนวณ history ใหม่; ระบบรอผลครบเพื่อให้ราคา อินดิเคเตอร์และออเดอร์ตรงกัน
