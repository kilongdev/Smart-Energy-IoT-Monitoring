# Smart Energy IoT Monitoring

Smart Energy & Equipment IoT Monitoring Platform for Campus & Buildings.

Mô tả đề tài và yêu cầu gốc: [Đề tài 19](docs/DE-TAI-19.md).

Công nghệ đã chốt: **EMQX** làm MQTT broker và **MongoDB** làm cơ sở dữ liệu.


Dự án theo báo cáo của Nhóm 19 – 1A: giám sát điện năng tòa nhà, cảnh báo và điều khiển thiết bị. Backend **NestJS 11 + MongoDB**, giao diện **React + ECharts**, truyền dữ liệu **MQTT**, cập nhật **Socket.IO**.

## 1. Chạy dự án: Atlas + EMQX Cloud

Chỉ backend/frontend chạy trên máy qua Docker; MongoDB ở Atlas và MQTT ở EMQX Cloud.
Không còn dịch vụ MongoDB/Mosquitto trong Compose. Dùng Node.js 22.x và Docker Desktop.

Nếu đã có `.env`, giữ nguyên. Máy mới chạy `node scripts/setup.mjs`, rồi điền:

| Biến | Giá trị |
|---|---|
| `MONGO_URI` | Connection string MongoDB Atlas |
| `MONGO_DB` | `smart_energy` |
| `MQTT_URL` | `mqtts://HOST_EMQX:8883` |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | Tài khoản EMQX |
| `SEED_DEMO` | `false` với database đang dùng |
| `DASHBOARD_URL` | URL public cho Telegram; để trống nếu chưa public |

```powershell
docker compose up -d --build api
docker compose ps api
```

Mở **http://localhost:3000**, Swagger **http://localhost:3000/docs**.
Frontend và backend dùng chung container `api`. Container đặt `NODE_ENV=production`.
`compose.cloud.yaml` là alias tương thích; cả hai lệnh Compose đều dùng cùng Atlas.
`npm.cmd run atlas:check` kiểm tra database (cần `npm ci` trên máy).
Không chạy lại migration trên database hiện tại. Xem [Atlas](docs/MONGODB_ATLAS.md).

Đăng nhập bằng tài khoản đã có. Với database trống, tài khoản admin được tạo theo
`ADMIN_USERNAME` và `ADMIN_PASSWORD`; sửa mật khẩu trong env không thay mật khẩu
của tài khoản đã tồn tại. `SEED_DEMO=true` chỉ dành cho tạo bộ dữ liệu demo ban đầu.

Chạy Wokwi để nhận dữ liệu ESP. Không chạy nhiều nguồn mô phỏng với cùng mã thiết bị.

## 2. Thử các chức năng

1. Đăng nhập `admin`, xem **Tổng quan**: số đo, biểu đồ, online/offline. Bộ lọc trên cùng chọn phạm vi tòa nhà.
2. Mở **Bản đồ nhiệt** để xem công suất theo phòng, tầng. Màu xanh/vàng/đỏ dựa vào tỷ lệ công suất hiện tại trên tổng công suất định mức. Phòng không có thiết bị online hiện màu xám.
3. Vào **Điều khiển**, bấm **Tắt**. Lệnh hiện đang chờ; khi nhận ACK mới ghi Thành công. Xem kết quả tại **Nhật ký**.
4. Mở **Cảnh báo**, thêm quy tắc công suất `> 100`, duy trì `10`, phục hồi `30`, nhắc lại `300` giây. Khi vi phạm đủ thời gian, cảnh báo xuất hiện. Cho số đo về khoảng cho phép liên tục 30 giây: hệ thống tự đánh dấu **Đã phục hồi** và gửi tin phục hồi. Không có thao tác xác nhận/xử lý thủ công. Xem [vòng đời cảnh báo](docs/ALERT_LIFECYCLE.md).
5. Vào **Lịch hẹn giờ**, chọn một giờ ở phía trước thời điểm hiện tại khoảng 1 phút, đúng ngày trong tuần. Lịch dùng giờ Việt Nam. Kiểm tra nhật ký có nguồn **Hẹn giờ**.
6. Vào **Quản trị** để thêm/sửa/xóa tòa nhà, tầng, phòng, thiết bị và tài khoản. Không xóa đối tượng còn được tham chiếu. Xóa tài khoản được thực hiện bằng khóa tài khoản, giữ lịch sử.

Biểu đồ điện năng cần ít nhất hai mẫu đo để tích phân. Tổng hợp chạy mỗi 2 giây; biểu đồ kỳ ngày/tuần/tháng hiển thị các giờ đã kết thúc, nên lần chạy đầu có thể trống cho đến đầu giờ kế tiếp. Biểu đồ công suất 15 phút hiển thị ngay khi có mẫu.

## 3. Demo bằng Wokwi hoặc Node simulator

Ưu tiên Wokwi với mã thiết bị và topic lấy từ nút **Kết nối ESP** trên web.
Node simulator là công cụ riêng: `npm.cmd run simulator`, dùng EMQX trong `.env`.
Nó sử dụng ID demo cố định; các ID phải tồn tại trên Atlas và không trùng ESP đang chạy.
Dừng simulator bằng Ctrl+C. Không còn container simulator trong Compose.

- `SIM_MODE`: `normal`, `overload`, `duplicate`.
- `SIM_ACK_MODE`: `normal`, `drop`, `wrong-id`, `mismatch`, `late`.
- Không có ACK sau 10 giây: **Chưa xác định**. ACK đến muộn vẫn cập nhật kết quả.
- Thiết bị offline khi không nhận dữ liệu quá 5 chu kỳ; chu kỳ 5 giây tương ứng 25 giây.
- Các biến SIM chỉ áp dụng Node simulator, không điều khiển chế độ trong Wokwi.

## 4. Cấu hình Telegram

Hướng dẫn tạo bot, lấy Chat ID và thử cảnh báo ESP32: [docs/TELEGRAM.md](docs/TELEGRAM.md).

Tạo bot bằng BotFather, nhắn `/start` cho bot hoặc thêm bot vào nhóm cần nhận thông báo, rồi điền:

```dotenv
TELEGRAM_BOT_TOKEN=token_cua_ban
TELEGRAM_CHAT_ID=chat_id_cua_ban
```

```powershell
docker compose up -d --build --force-recreate api
```

Khi cả hai giá trị trống, cảnh báo vẫn lưu trên web và trạng thái gửi là **Chưa cấu hình**, không giả lập gửi thành công. Khi cấu hình hợp lệ, cảnh báo mới/đến kỳ gửi lại sẽ được gửi tới **một Chat ID vận hành chung**. Phiên bản này chưa có kênh Telegram riêng cho từng người dùng hoặc từng tòa nhà; chỉ dùng nhóm nhận được phép biết dữ liệu toàn hệ thống.

Hàng đợi gửi được lưu cùng cảnh báo; worker kiểm tra mỗi giây, gửi cách nhau ít nhất 3,1 giây trong một tiến trình, timeout HTTP 5 giây. Mỗi lượt thử tối đa ba lần, chờ 30/60 giây giữa các lần thử và không ngắn hơn `retry_after` của Telegram. Tin **phát hiện**, **nhắc sự cố chưa phục hồi** và **thông số đã phục hồi** được phân biệt rõ; nhắc ít nhất cách nhau 5 phút. Phục hồi cần số đo bình thường liên tục (mặc định 30 giây), không cần người dùng xác nhận. Tin phục hồi có hàng đợi riêng trong cùng bản ghi để không bị lượt gửi cũ ghi đè. **Thành công** có nghĩa Telegram đã chấp nhận tin, không khẳng định người nhận đã đọc. Email chưa triển khai.

Sau khi build, chạy `npm.cmd run telegram -- chats` để tra Chat ID, `npm.cmd run telegram -- check` để kiểm tra cấu hình hoặc `npm.cmd run telegram -- test` để gửi tin thử.

## 5. Chạy Node trực tiếp để sửa code

Node trực tiếp cũng đọc `MONGO_URI` Atlas và `MQTT_URL` EMQX từ `.env`.
Dừng container API trước để không có hai backend cùng điều khiển thiết bị:

```powershell
docker compose stop api
npm ci
npm run start:dev
```

Khi sửa TypeScript/React, chạy lại `npm run build`. Dừng Node bằng Ctrl+C trước
khi khởi động lại API Docker. Không cần cài MongoDB hoặc broker trên máy.

## 6. Cấu trúc mã nguồn

| File/thư mục | Nội dung |
|---|---|
| `src/app.ts`, `main.ts` | Khởi động NestJS, validation, Swagger, static frontend, xử lý lỗi |
| `src/security.ts` | JWT, băm mật khẩu, guard vai trò và phạm vi tòa nhà |
| `src/database.ts` | MongoDB driver, chỉ mục unique/TTL |
| `src/catalog.ts`, `catalog.controllers.ts` | CRUD tòa nhà, tầng, phòng, thiết bị, tài khoản |
| `src/dto.ts` | DTO và kiểm tra dữ liệu đầu vào |
| `src/mqtt.ts` | MQTT QoS 1, kiểm tra payload/topic, reconnect |
| `src/telemetry.ts` | Chống trùng, lưu telemetry, cập nhật số đo và phát sự kiện |
| `src/analytics.ts` | Tích phân điện năng, tổng hợp theo giờ, heatmap, biểu đồ |
| `src/alerts.ts` | Rule engine, debounce, cooldown, vòng đời cảnh báo, Telegram |
| `src/control.ts` | Command–ACK, timeout, ACK muộn, nhật ký |
| `src/schedules.ts` | Kiểm tra lịch từng giây, chống chạy trùng |
| `src/events.ts` | Socket.IO xác thực và phòng sự kiện theo tòa nhà |
| `src/seed.ts` | Tài khoản đầu tiên và dữ liệu demo |
| `web/` | Giao diện React tiếng Việt và ECharts |
| `scripts/simulator.mjs` | Ba thiết bị MQTT mô phỏng |
| `scripts/load-test.mjs` | Sinh tải 50 thiết bị, đối chiếu số gửi/số lưu |
| `firmware/` | ESP32 demo QoS 1, điều khiển GPIO, số đo mô phỏng |
| `test/` | Kiểm thử domain, API/MQTT và MongoDB integration |
| `docs/` | Giao thức, thay đổi so với báo cáo và kết quả kiểm tra |

Các service được đăng ký trong `AppModule` để dự án sinh viên dễ chạy và lần theo luồng. Dùng **MongoDB Node.js driver trực tiếp**, không dùng Mongoose. UUID lưu dưới dạng chuỗi `_id`; API trả thêm các mã `ma_*` tương ứng.

## 7. Kiểm thử

```powershell
npm ci
npm test
npm run test:integration
```

- `npm test`: unit test + kiểm thử HTTP của NestJS và MQTT TCP với Aedes. **Lớp MongoDB được thay thế bằng test double**; không xác nhận hành vi MongoDB thật, TTL hoặc tốc độ DB.
- `npm run test:integration`: cùng các tình huống, khởi động **MongoDB 8.0.5 thật** trong thư mục tạm qua mongodb-memory-server. Lần đầu tải binary từ MongoDB, cần mạng và quyền chạy tiến trình. Aedes là broker kiểm thử; môi trường vận hành dùng EMQX Cloud.
- `docs/TEST_REPORT.md`: bằng chứng kiểm tra và các mục chưa kiểm chứng.

Kiểm tra tải theo NFR04, chỉ chạy trên môi trường demo:

```powershell
# Chạy hệ thống trước. Mặc định: 50 thiết bị, 600 giây, mỗi 5 giây.
node --env-file=.env scripts/load-test.mjs
```

Script tạo một tòa nhà riêng mang tên Benchmark, không sửa thiết bị cũ; cuối cùng in số gửi, số lưu, tỷ lệ mất bản ghi. Dữ liệu benchmark được giữ lại để đối chiếu. Chưa mặc định khẳng định đạt tải 50 thiết bị hoặc biểu đồ 30 ngày dưới 3 giây: cần chạy phép đo trên máy triển khai thực tế.

## 8. ESP32 và Wokwi

Demo EMQX Cloud TLS hiện dùng [Wokwi](wokwi/README.md): thêm thiết bị trên web, lấy mã/topic qua **Kết nối ESP**, điền tài khoản EMQX vào bản sketch của riêng bạn. Không commit mật khẩu đã điền.

`firmware/` là bản ESP32 khác dùng MQTT TCP cổng 1883, chưa cấu hình TLS cho EMQX 8883. Không nạp nguyên bản này với endpoint chỉ hỗ trợ TLS. Nếu sử dụng, sao chép `src/config.example.h` thành `src/config.h`, bổ sung TLS theo thư viện/phần cứng và kiểm thử trước. `config.h` được loại khỏi Git và Docker build.

Firmware hiện dùng GPIO 2 làm LED/relay demo và tạo số đo giả. Muốn đo thật phải thay phần đọc số đo bằng driver cảm biến/đồng hồ phù hợp, hiệu chuẩn và bổ sung phần cứng phản hồi. ACK của chương trình xác nhận GPIO/trạng thái do ESP32 báo; không độc lập chứng minh dòng điện tải đã ngắt.


## 9. Vận hành và giới hạn hiện tại

- Phiên bản dành cho demo/đồ án, **một tiến trình API**. Không scale `api` nhiều replica: rule engine, hàng đợi theo thiết bị và worker hiện chạy trong một tiến trình. Có chống trùng lịch bằng khóa DB nhưng không phải toàn bộ kiến trúc phân tán.
- Không bảo đảm giao dịch đa collection khi crash giữa chừng. Dữ liệu telemetry chưa hoàn tất có cờ `processed` để thử xử lý lại; notification không có cam kết exactly-once khi mạng đứt sau khi Telegram nhận tin.
- Backend kết nối EMQX bằng `mqtts://` và tài khoản cấu hình trong env. Quyền topic được quản lý ở EMQX; thiết bị triển khai thật nên có tài khoản riêng. Sketch Wokwi dùng TLS nhưng đang gọi `setInsecure()`, chưa xác minh chứng chỉ máy chủ; cần bổ sung CA khi triển khai thực tế.
- MongoDB dùng Atlas với database user được cấp quyền cho `smart_energy`. Compose không chạy MongoDB và không dùng tài khoản root local. Backend/frontend hiện chỉ mở cổng trên máy; muốn public cần hosting hoặc reverse proxy có HTTPS.
- Đăng nhập giới hạn 15 yêu cầu/phút/IP trong một process. JWT sống 8 giờ; tài khoản bị khóa/đổi quyền được kiểm tra lại trên mỗi API request. Socket kiểm tra lại token mỗi 30 giây và bị ngắt ngay khi quản trị viên sửa/khóa tài khoản.
- Phân quyền cảnh báo/điều khiển ở API; ẩn nút phía frontend chỉ là hỗ trợ giao diện. `ma_nguoi_dung` luôn lấy từ JWT, không nhận từ body điều khiển.
- Chỉ số W, V, A và nhiệt độ chưa đủ chứng minh rò điện. Rule engine phát hiện **vi phạm ngưỡng/ngoài giờ**; phát hiện rò điện thật cần cảm biến/chênh lệch dòng và quy tắc riêng.
- NFR03 thay đổi theo yêu cầu MongoDB: không còn hypertable hay continuous aggregate của TimescaleDB. Xem `docs/REPORT_MAPPING.md`.

Lệnh thường dùng cho Atlas:

```powershell
docker compose logs --tail=100 api
docker compose stop api
docker compose up -d api
```

Nếu cổng 3000 bị chiếm, đổi `PORT=3001` trong `.env`, chạy `docker compose up -d api`, mở `http://localhost:3001`.

Nếu web báo `ERR_CONNECTION_REFUSED`, kiểm tra trạng thái container và chạy `npm.cmd run atlas:check`. Khi Atlas không kết nối được, kiểm tra IP Access List (IP public có thể đổi), trạng thái cluster và tài khoản database. Không kết luận mọi lỗi TLS đều do IP; không tự đổi database khi chưa kiểm tra dữ liệu.


## 10. Đưa code lên Git và triển khai hosting

### Kiểm tra trước khi commit

```powershell
git status --short
git diff --check
git diff --cached --stat
```

Không đưa `.env`, `firmware/src/config.h`, bản sao lưu BSON hoặc token/mật khẩu
vào Git. File mẫu chỉ chứa placeholder. `.gitignore` không bảo vệ file đã được
track từ trước; phải kiểm tra cả staged diff. Không dán cấu hình Docker đã bung
biến môi trường vào issue hoặc README vì có thể chứa mật khẩu.

Repo đã có Git, không cần chạy lại `git init` hoặc thêm lại remote.
Sau khi kiểm tra diff, stage bản sửa cuối cùng rồi commit/push lên nhánh của bạn.
Không dùng lại bản staged cũ khi file đang có trạng thái `MM` hoặc `AM`.

### Render (tùy chọn, chưa phải môi trường đang chạy)

Backend, frontend React và Swagger được phục vụ bởi một Node Web Service.
`render.yaml` là Blueprint để tạo service; không tự chuyển dữ liệu hoặc tự tắt
backend Docker. Chỉ vận hành một backend cho cùng nhóm ESP để tránh tranh chấp
MQTT Client ID và chạy trùng worker.

1. Push repo, trên Render chọn **New → Blueprint**, chọn repo/nhánh chứa `render.yaml`.
2. Điền `MONGO_URI` Atlas, `MQTT_URL`/`MQTT_USERNAME`/`MQTT_PASSWORD` EMQX,
   mật khẩu khởi tạo admin/demo, Telegram nếu sử dụng và `DASHBOARD_URL` là URL web public.
3. Cho phép IP outbound của service trong Atlas IP Access List. Cấp tài khoản EMQX
   quyền publish command/config và subscribe telemetry/ack trên đúng topic thiết bị.
4. Giữ `SEED_DEMO=false` với database hiện có. Tài khoản cũ giữ nguyên mật khẩu;
   biến `ADMIN_PASSWORD` không đổi mật khẩu đã lưu trong database.
5. Sau deploy, kiểm tra `/`, `/docs`, `/api/v1/health` và đăng nhập.
   Health trả HTTP 200 chưa đủ xác nhận MQTT: kiểm tra thêm trường `mqtt`.

Blueprint đặt Node theo `.node-version`, sinh JWT secret và dùng:

```text
Build: npm ci --include=dev --no-audit --no-fund && npm run build
Start: npm start
Health: /api/v1/health
```

`--include=dev` cần cho TypeScript/esbuild lúc build. Biến
`MONGOMS_DISABLE_POSTINSTALL=true` bỏ tải MongoDB binary dùng riêng cho test.
Runtime dùng `NODE_ENV=production`, `MONGO_DB=smart_energy`; hosting cấp `PORT`.
Không dùng Compose trên Render. Tiếp tục chạy Wokwi với cùng broker/mã thiết bị.

Blueprint hiện chọn plan `free`; hãy kiểm tra giới hạn, giá và chính sách sleep
trước khi sử dụng. Service ngủ hoặc dừng thì không nhận telemetry, không gửi cảnh
báo hoặc thực thi lịch; polling frontend không thể khắc phục backend đang dừng.
Không lưu backup quan trọng trên filesystem tạm của hosting.

## 11. Tài liệu kỹ thuật đã đối chiếu

- NestJS MongoDB: https://docs.nestjs.com/v11/techniques/mongodb
- NestJS Authentication: https://docs.nestjs.com/v11/techniques/authentication
- MongoDB TTL: https://www.mongodb.com/docs/v8.0/core/index-ttl/
- MongoDB compound indexes: https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/
- Render Blueprint: https://render.com/docs/blueprint-spec
- Render Node version: https://render.com/docs/node-version
- Render free tier: https://render.com/docs/free
- Render connect MongoDB Atlas: https://render.com/docs/connect-to-mongodb-atlas

`package-lock.json` khóa phiên bản package dùng trong bản bàn giao. Không chứa `.env`, mật khẩu thật hoặc `node_modules` trong gói mã nguồn.
