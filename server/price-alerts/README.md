# EBW Price Alerts

หน้า Live ใช้ Eightcap Bid ตรวจราคาแตะระดับหรือข้ามตามทิศที่เลือก เมื่อเลือกครั้งเดียวจะพักรายการหลังแจ้งครั้งแรก เงื่อนไขทำงานจากราคาสดที่ระบบเห็นจริง หยุดประมวลผลเมื่อข้อมูลล่าช้าหรือตลาดปิด

- **ขณะเปิด Live** — รายการและประวัติเก็บในเบราว์เซอร์เดียวกัน เปิดสิทธิ์ในแท็บอุปกรณ์เพื่อรับการแจ้งเตือนระดับระบบปฏิบัติการด้วย
- **ข้ามอุปกรณ์** — บริการออนไลน์เก็บรายการชุดเดียวและส่ง Web Push ไปยังทุกเครื่องที่เปิดรับ หากคอมปิด มือถือยังรับได้ตราบใดที่บริการแจ้งเตือนและ Eightcap Bridge ยังออนไลน์ เปิดบน iPhone หรือ iPad จากแอป EBW ที่เพิ่มไว้บนหน้าจอโฮมผ่าน Safari (iOS/iPadOS 16.4 ขึ้นไป)
- บริการตรวจ Bid ทุกประมาณ 5 วินาทีขณะตลาดเปิดและมีรายการทำงาน เป้าที่ราคาเคลื่อนผ่านแล้วกลับก่อนอ่านรอบถัดไปอาจตรวจไม่พบ

## Deploy the private alert workspace

The static site and the alert service have separate deployments. Sign into an authorized Cloudflare Workers account, create credentials once and preserve the file privately. Keep the file outside the repository. Rotating the VAPID keys requires enrolling devices again.

~~~powershell
npm ci
npm exec --yes --package=wrangler -- wrangler login
$alertCredentials = Join-Path $env:LOCALAPPDATA 'ebw-alert-credentials.json'
node server/price-alerts/credentials.mjs $alertCredentials
npm exec --yes --package=wrangler -- wrangler deploy --config server/price-alerts/wrangler.toml --secrets-file $alertCredentials
~~~

Use the deployed HTTPS URL and the generated ALERT_ACCESS_TOKEN from the secure file in **แจ้งเตือนราคา → อุปกรณ์ → เชื่อมต่อ**. Enter the same details on each device, enable push on each and use **ทดสอบ Push**. Share the token privately. It grants access to all alerts and device registrations for this workspace. It belongs outside GitHub, URLs and screenshots.

For a protected or stable remote Eightcap Bridge, set ALERT_QUOTE_URL and ALERT_QUOTE_KEY as Worker secrets. Use the complete quote URL. Without overrides the worker uses the same public bridge and fallback as the live chart. If the bridge itself runs on the desktop, deploy it to an always-on system as well before relying on alerts with that computer shut down.

The active alert list is independent from local chart layouts. Connecting a device switches to the shared list. Disconnecting returns the device to its local list.
