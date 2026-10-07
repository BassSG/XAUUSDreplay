# Replay continuity fix · 7 ตุลาคม 2026

ปัญหาเดิม: UI ทิ้งผล Pine เมื่อ cursor เปลี่ยน ทำให้เส้น โซน และ oscillator หายทุกแท่งขณะ Play แม้ worker จะใช้ updateTail อยู่แล้ว นอกจากนี้ Fibo บนกราฟ 15m อาจล้มเหลวเพราะ PineTS สร้าง dynamic request slice จากการเรียก Hero 10m ครั้งแรก แล้วนำไปใช้กับการเรียก 30m ที่ต้องใช้คนละ branch

## การแก้

- ใช้ worker เดิมและ incremental state เตรียมผลของจุดถัดไปโดยไม่เปิดเผยบนจอ ก่อน commit cursor ราคา การจำลองออเดอร์ และ Pine พร้อมกัน ผลผูกกับรอบ/TF/calendar/source/inputs/จำนวนแท่ง/OHLC ของแท่งที่กำลังก่อตัว
- เก็บผลล่าสุดไม่เกิน 6 จุดและจำกัดจำนวน plot points ป้องกันภาพหายเมื่อย้อนในแคช เก็บจุดปัจจุบันไว้ขณะเตรียมจุดถัดไป
- Pause ยกเลิก timer ที่รอ commit; การเปลี่ยนรอบหรือ TF ยกเลิก worker และ promise เก่า ปัญหาคำนวณ/timeout แจ้ง error และหยุด Play
- แก้ Hero slice ให้ใช้ TF และ function call scope ของคำขอจริงทั้ง security และ security_lower_tf รองรับ argument ที่ inline และที่ transpiler ยกไปเป็น parameter ตัวแปร ไม่แก้ไฟล์ Pine ต้นฉบับ
- ซ่อน indicator label, box text, plot marker text และ table dashboard เป็นค่าเริ่มต้น เปิดกลับได้แยกจากกันโดยไม่เริ่ม worker ใหม่ เส้น โซน ลูกศร รูปทรง และข้อความออเดอร์ยังอยู่

## หลักฐาน

- Full Fibo บนข้อมูลจริง M1 ณ 30 ก.ย. 2026 10:45 Bangkok, แสดงกราฟ 15m: initial 51,823ms; forward 415ms และ 473ms; ไม่มี error (benchmark หนึ่งอินดิเคเตอร์ ก่อนทดสอบ UI สองตัว)
- Regression dynamic Hero: เรียก 10m ก่อน 30m บน 15m ต้องได้ค่าตรงกับคำขอ 30m แยกโดยตรง; บน 1h คำขอ lower 30m ต้องได้ packets ของตนเอง ไม่ใช่ array ว่าง
- Regression full Fibo 15m: forming-candle forward ใช้ incremental mode และ plot/table เท่ากับ cold result
- Regression full All Indy + Fibo: ทั้งสองต้องใช้ incremental mode ขณะ forward; plot/table เท่ากับ cold result และ Zone Bridge ยังเชื่อมครบ
- Browser localhost, M1 clock / 15m chart, สอง full indicators: ระหว่าง Play เก็บ DOM 35 ครั้งผ่านเวลา 11:12 → 11:13 → 11:14; ไม่พบ overlay ว่าง, loading frame หรือ indicator text; มีวัตถุเส้น/โซน 34 ชิ้น
- Pause คงเวลา 11:14; เปิดข้อความได้ 28 จุดแล้วปิดเหลือ 0 โดยสถานะยังพร้อม; ย้อน 11:13 และเดินหน้า 11:14 กลับได้พร้อมวัตถุ 34 ชิ้นและไม่มี loading state

การโหลดครั้งแรกและการเปลี่ยน source/inputs/TF ยังต้องคำนวณประวัติเต็ม ความเร็วสูงสุดขึ้นกับเครื่อง ไม่อ้างว่าทุกสคริปต์ทำงานถึง 20× หรือเหมือน TradingView ทุกค่าโดยไม่มี golden reference
