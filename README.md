# Smart Energy IoT Monitoring

Smart Energy & Equipment IoT Monitoring Platform for Campus & Buildings.

Mô tả đề tài và yêu cầu gốc: [Đề tài 19](docs/DE-TAI-19.md).

Công nghệ đã chốt: **EMQX** làm MQTT broker và **MongoDB** làm cơ sở dữ liệu.

## Project Structure

```text
Smart-Energy-IoT-Monitoring/
│
├── frontend/              # React frontend
│   ├── src/
│   ├── public/
│   └── package.json
│
├── backend/               # Node.js + Express backend
│   ├── src/
│   ├── package.json
│   └── .env.example
│
├── simulator/             # ESP32 / sensor simulator
│   ├── simulator.py
│   └── requirements.txt
│
├── database/              # Database configuration and scripts
│
├── docs/                  # Project documentation
│
├── .gitignore
├── README.md
└── docker-compose.yml
# Smart Energy IoT

Dự án theo báo cáo của Nhóm 19 – 1A: giám sát điện năng tòa nhà, cảnh báo và điều khiển thiết bị. Backend **NestJS 11 + MongoDB**, giao diện **React + ECharts**, truyền dữ liệu **MQTT**, cập nhật **Socket.IO**.

## 1. Chạy nhanh trên Windows

Cài **Node.js 22 trở lên** và **Docker Desktop** (bật Linux containers). Giải nén dự án, mở PowerShell tại thư mục chứa `package.json` và `compose.yaml`:

```powershell
node scripts/setup.mjs
docker compose up --build -d
docker compose ps
```

`setup.mjs` sinh `.env` với mật khẩu ngẫu nhiên và in tài khoản đăng nhập. Không cần `npm install` trên máy host nếu chỉ chạy Docker. Lần build đầu cần Internet để tải các image và npm packages.

- Giao diện: **http://localhost:3000**
- Swagger: **http://localhost:3000/docs**
- OpenAPI JSON: **http://localhost:3000/docs-json**
- API: **http://localhost:3000/api/v1**
- MongoDB trên host: `localhost:27018`; bên trong Docker: `mongo:27017`.
- MQTT trên host: `localhost:1883`; bên trong Docker: `mqtt:1883`.

| Tài khoản | Mật khẩu lấy ở đâu | Quyền |
|---|---|---|
| `admin` | `ADMIN_PASSWORD` trong `.env` | Tất cả tòa nhà, quản trị danh mục và người dùng |
| `manager` | `DEMO_PASSWORD` trong `.env` | Giám sát, cảnh báo, điều khiển, hẹn giờ ở tòa A |
| `viewer` | `DEMO_PASSWORD` trong `.env` | Chỉ xem dữ liệu tòa A |

Dữ liệu khởi tạo: 1 tòa nhà, 1 tầng, 3 phòng và 3 thiết bị. Simulator **không chạy mặc định** để tránh ghi đè dữ liệu từ ESP32; khi bật, nó gửi dữ liệu mỗi 5 giây, nhận lệnh và phản hồi ACK. Đây là số đo **mô phỏng**, không phải dữ liệu điện thực tế.

Khi dùng ESP32 thật, dừng container simulator nếu trước đó đã bật:

```powershell
docker compose stop simulator
```

Muốn chạy lại simulator cho demo, bật riêng profile của nó:

```powershell
docker compose --profile simulator up -d simulator
```

Giao diện và API dùng chung cổng, được NestJS phục vụ trong container `api`. Không cần khởi động thêm frontend. Mật khẩu chỉ được seed khi tài khoản chưa tồn tại; sửa `.env` không tự đổi mật khẩu tài khoản đã có trong DB. Đổi mật khẩu trong màn hình Quản trị.

## 2. Thử các chức năng

1. Đăng nhập `admin`, xem **Tổng quan**: số đo, biểu đồ, online/offline. Bộ lọc trên cùng chọn phạm vi tòa nhà.
2. Mở **Bản đồ nhiệt** để xem công suất theo phòng, tầng. Màu xanh/vàng/đỏ dựa vào tỷ lệ công suất hiện tại trên tổng công suất định mức. Phòng không có thiết bị online hiện màu xám.
3. Vào **Điều khiển**, bấm **Tắt**. Lệnh hiện đang chờ; khi nhận ACK mới ghi Thành công. Xem kết quả tại **Nhật ký**.
4. Mở **Cảnh báo**, thêm quy tắc công suất `> 100`, duy trì `10`, phục hồi `30`, nhắc lại `300` giây. Khi vi phạm đủ thời gian, cảnh báo xuất hiện. Cho số đo về khoảng cho phép liên tục 30 giây: hệ thống tự đánh dấu **Đã phục hồi** và gửi tin phục hồi. Không có thao tác xác nhận/xử lý thủ công. Xem [vòng đời cảnh báo](docs/ALERT_LIFECYCLE.md).
5. Vào **Lịch hẹn giờ**, chọn một giờ ở phía trước thời điểm hiện tại khoảng 1 phút, đúng ngày trong tuần. Lịch dùng giờ Việt Nam. Kiểm tra nhật ký có nguồn **Hẹn giờ**.
6. Vào **Quản trị** để thêm/sửa/xóa tòa nhà, tầng, phòng, thiết bị và tài khoản. Không xóa đối tượng còn được tham chiếu. Xóa tài khoản được thực hiện bằng khóa tài khoản, giữ lịch sử.

Biểu đồ điện năng cần ít nhất hai mẫu đo để tích phân. Tổng hợp chạy mỗi 2 giây; biểu đồ kỳ ngày/tuần/tháng hiển thị các giờ đã kết thúc, nên lần chạy đầu có thể trống cho đến đầu giờ kế tiếp. Biểu đồ công suất 15 phút hiển thị ngay khi có mẫu.

## 3. Các chế độ demo lỗi

Sửa biến trong `.env`, rồi tạo lại simulator:

```powershell
docker compose --profile simulator up -d --force-recreate simulator
```

| Biến | Giá trị | Kết quả |
|---|---|---|
| `SIM_MODE` | `normal` | Số đo bình thường |
| `SIM_MODE` | `overload` | Công suất khoảng 2.4 kW khi bật, dùng để thử cảnh báo |
| `SIM_MODE` | `duplicate` | Gửi mỗi telemetry hai lần, DB chỉ lưu một lần |
| `SIM_ACK_MODE` | `normal` | ACK sau khoảng 150 ms |
| `SIM_ACK_MODE` | `drop` | Relay đổi nhưng không ACK; sau 10 giây ghi Chưa xác định |
| `SIM_ACK_MODE` | `wrong-id` | ACK sai mã lệnh, bị bỏ qua |
| `SIM_ACK_MODE` | `mismatch` | ACK báo trạng thái không khớp, ghi thất bại |
| `SIM_ACK_MODE` | `late` | ACK sau 11.5 giây; cập nhật Chưa xác định thành kết quả ACK và ghi ACK muộn |

Trong chế độ mất ACK, telemetry vẫn có thể cho biết relay đã đổi; lệnh giữ trạng thái Chưa xác định cho đến khi nhận ACK đúng mã. Không suy đoán thành công chỉ từ relay hoặc công suất bằng 0. ACK muộn cập nhật kết quả lệnh cũ nhưng không ghi đè trạng thái thiết bị của lệnh mới hơn.

Thử offline:

```powershell
docker compose stop simulator
# Chờ hơn 15 giây nếu chu kỳ là 5 giây, rồi kiểm tra dashboard.
docker compose start simulator
```

Thử tự kết nối lại MQTT:

```powershell
docker compose restart mqtt
```

Không dùng đồng thời simulator và ESP32 cho cùng một mã thiết bị. Hai nguồn đo chung mã sẽ làm số liệu và trạng thái không nhất quán.

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

Hàng đợi gửi được lưu cùng cảnh báo; worker kiểm tra mỗi giây, gửi cách nhau ít nhất 3,1 giây trong một tiến trình, timeout HTTP 5 giây. Mỗi lượt thử tối đa ba lần, chờ 30/60 giây giữa các lần thử và không ngắn hơn `retry_after` của Telegram. Tin **phát hiện**, **nhắc sự cố chưa phục hồi** và **đã xử lý tự động** được phân biệt rõ; nhắc ít nhất cách nhau 5 phút. Phục hồi cần số đo bình thường liên tục (mặc định 30 giây), không cần người dùng xác nhận. Tin phục hồi có hàng đợi riêng trong cùng bản ghi để không bị lượt gửi cũ ghi đè. **Thành công** có nghĩa Telegram đã chấp nhận tin, không khẳng định người nhận đã đọc. Email chưa triển khai.

Sau khi build, chạy `npm.cmd run telegram -- chats` để tra Chat ID, `npm.cmd run telegram -- check` để kiểm tra cấu hình hoặc `npm.cmd run telegram -- test` để gửi tin thử.

## 5. Chạy backend ngoài Docker để sửa code

```powershell
node scripts/setup.mjs
docker compose up -d mongo mqtt
npm ci
npm run start:dev
```

Terminal thứ hai:

```powershell
npm run simulator
```

`start:dev` build một lần rồi theo dõi file JavaScript trong `dist`. Khi sửa TypeScript hoặc React, chạy lại `npm run build` ở terminal khác để cập nhật bản biên dịch. Muốn frontend mới, tải lại trình duyệt. Có thể dùng `npx tsc --watch` để tự biên dịch backend.

Nếu đã có container `api` đang chiếm cổng 3000, dừng nó trước: `docker compose stop api simulator`.

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
- `npm run test:integration`: cùng các tình huống, khởi động **MongoDB 8.0.5 thật** trong thư mục tạm qua mongodb-memory-server. Lần đầu tải binary từ MongoDB, cần mạng và quyền chạy tiến trình. Aedes là broker kiểm thử; Mosquitto/ACL được dùng trong Docker.
- `docs/TEST_REPORT.md`: bằng chứng kiểm tra và các mục chưa kiểm chứng.

Kiểm tra tải theo NFR04, chỉ chạy trên môi trường demo:

```powershell
# Chạy hệ thống trước. Mặc định: 50 thiết bị, 600 giây, mỗi 5 giây.
node --env-file=.env scripts/load-test.mjs
```

Script tạo một tòa nhà riêng mang tên Benchmark, không sửa thiết bị cũ; cuối cùng in số gửi, số lưu, tỷ lệ mất bản ghi. Dữ liệu benchmark được giữ lại để đối chiếu. Chưa mặc định khẳng định đạt tải 50 thiết bị hoặc biểu đồ 30 ngày dưới 3 giây: cần chạy phép đo trên máy triển khai thực tế.

## 8. ESP32 và Wokwi

Trong `firmware/`, sao chép `src/config.example.h` thành `src/config.h`, điền Wi-Fi, IP máy chạy MQTT và `SIM_MQTT_PASSWORD`. Dừng simulator khi dùng ID demo. Mở bằng VS Code + PlatformIO, build và nạp.

Firmware hiện dùng GPIO 2 làm LED/relay demo và tạo số đo giả. Muốn đo thật phải thay phần đọc số đo bằng driver cảm biến/đồng hồ phù hợp, hiệu chuẩn và bổ sung phần cứng phản hồi. ACK của chương trình xác nhận GPIO/trạng thái do ESP32 báo; không độc lập chứng minh dòng điện tải đã ngắt.

Compose mặc định chỉ mở MQTT ở `127.0.0.1` và không bật simulator để chạy ESP32 thật trên máy cá nhân. Khi kết nối ESP32 cùng LAN, đổi riêng dòng cổng MQTT thành `"1883:1883"`, giới hạn firewall cho mạng nội bộ, dùng địa chỉ IP LAN của máy. Wokwi cloud không tự truy cập được `localhost` của máy; cần Wokwi IoT Gateway hoặc một broker mà Wokwi truy cập được. File firmware chưa được biên dịch/nạp trên phần cứng trong lần bàn giao này.

## 9. Vận hành và giới hạn hiện tại

- Phiên bản dành cho demo/đồ án, **một tiến trình API**. Không scale `api` nhiều replica: rule engine, hàng đợi theo thiết bị và worker hiện chạy trong một tiến trình. Có chống trùng lịch bằng khóa DB nhưng không phải toàn bộ kiến trúc phân tán.
- Không bảo đảm giao dịch đa collection khi crash giữa chừng. Dữ liệu telemetry chưa hoàn tất có cờ `processed` để thử xử lý lại; notification không có cam kết exactly-once khi mạng đứt sau khi Telegram nhận tin.
- Broker demo cho `energy_sim` quyền trên ba topic demo; thiết bị thật cần tài khoản/ACL riêng. Không dùng tài khoản `energy_api` trên ESP32. MQTT TCP chưa có TLS; chưa dành cho Internet công cộng.
- MongoDB của Compose dùng tài khoản root cho triển khai cục bộ; triển khai thật cần tài khoản ứng dụng chỉ được truy cập DB `smart_energy`, TLS, sao lưu và HTTPS cho web/API.
- Đăng nhập giới hạn 15 yêu cầu/phút/IP trong một process. JWT sống 8 giờ; tài khoản bị khóa/đổi quyền được kiểm tra lại trên mỗi API request. Socket kiểm tra lại token mỗi 30 giây và bị ngắt ngay khi quản trị viên sửa/khóa tài khoản.
- Phân quyền cảnh báo/điều khiển ở API; ẩn nút phía frontend chỉ là hỗ trợ giao diện. `ma_nguoi_dung` luôn lấy từ JWT, không nhận từ body điều khiển.
- Chỉ số W, V, A và nhiệt độ chưa đủ chứng minh rò điện. Rule engine phát hiện **vi phạm ngưỡng/ngoài giờ**; phát hiện rò điện thật cần cảm biến/chênh lệch dòng và quy tắc riêng.
- NFR03 thay đổi theo yêu cầu MongoDB: không còn hypertable hay continuous aggregate của TimescaleDB. Xem `docs/REPORT_MAPPING.md`.

Lệnh thường dùng:

```powershell
docker compose logs --tail=100 api
docker compose logs --tail=100 mqtt
docker compose logs --tail=100 simulator
docker compose down
# down giữ volume dữ liệu; không thêm -v nếu muốn giữ dữ liệu.
```

Nếu cổng 3000 bị chiếm, đổi `PORT=3001` trong `.env`, chạy `docker compose up -d`, mở `http://localhost:3001`. Nếu MongoDB báo Authentication failed sau khi đổi mật khẩu trong `.env`, kiểm tra mật khẩu tài khoản đã tồn tại trong volume; biến khởi tạo chỉ có tác dụng khi DB được tạo lần đầu.

## 10. Triển khai lên Render

Dự án chạy trên Render dưới dạng **Web Service** (Node.js). Backend, giao diện React và Swagger đều dùng chung một tiến trình trên cùng cổng.

### 10.1. Chuẩn bị trước khi deploy

| Thành phần | Ghi chú |
|---|---|
| GitHub/GitLab | Render kết nối qua Git provider. Repo phải chứa `package.json` ở thư mục gốc. |
| MongoDB | Dùng **MongoDB Atlas** (gói M0 miễn phí). Render không có MongoDB miễn phí có đĩa bền. |
| MQTT broker | Dùng broker cloud (EMQX Cloud, HiveMQ Cloud, hoặc broker công cộng `broker.emqx.io` cho demo). |
| Node.js | Dự án pin `22.23.4` qua file `.node-version`. Cần ≥ 22.9 vì `npm start` dùng cờ `--env-file-if-exists`. |

### 10.2. Đưa code lên Git

Thư mục `Smart-Energy-IoT-Monitoring-main` chính là thư mục gốc của repo:

```powershell
cd Smart-Energy-IoT-Monitoring-main
git init
git add .
git commit -m "Smart Energy IoT"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

`.gitignore` đã loại `node_modules/`, `dist/`, `public/assets/` và `.env`, nên không push mật khẩu thật lên GitHub.

### 10.3. Tạo MongoDB Atlas

1. Đăng ký [MongoDB Atlas](https://www.mongodb.com/atlas), tạo cluster gói **M0 (Free)**.
2. Chọn provider gần Render nhất. Nếu Render đặt ở `singapore` thì chọn AWS `Singapore`; Render đặt ở `oregon`/`ohio`/`virginia` thì chọn AWS tương ứng.
3. **Database Access** → tạo user (ví dụ `smartenergy`) và password.
4. **Network Access** → thêm IP của Render. Render free dùng IP dải dùng chung theo region:
   - Mở service trên Render → **Connect** → tab **Outbound** → copy dải CIDR.
   - Thêm từng dải vào Atlas IP Access List.
   - Nếu không muốn chờ IP dải dùng chung, dùng `0.0.0.0/0` (Atlas sẽ cảnh báo, chỉ nên dùng cho đồ án demo).
5. **Connect** → chọn driver **Node.js** → copy connection string dạng `mongodb+srv://...`.

### 10.4. Tạo MQTT broker

Các lựa chọn miễn phí:

- **EMQX Cloud Serverless** — miễn phí vĩnh viễn (1M session phút/tháng, 1 GB lưu lượng). Có username/password và TLS.
- **HiveMQ Cloud** — gói free 100 kết nối, 10 GB/tháng. Lưu ý HiveMQ Cloud Serverless sẽ ngừng hoạt động từ 31/12/2026.
- **Broker công cộng `broker.emqx.io:1883`** — không cần đăng ký, nhưng mọi người đều đọc được tin nhắn. Chỉ dùng để demo với dữ liệu mô phỏng.

Broker cần cho phép topic `campus/#` và các topic `campus/demo/+/telemetry`, `/ack`, `/command`, `/config`.

### 10.5. Deploy trên Render

**Cách A — dùng Blueprint (khuyến nghị):**

1. Render Dashboard → **New** → **Blueprint**.
2. Chọn repo đã push → Render đọc file `render.yaml`.
3. Render hiển thị các biến cần nhập tay:
   - `MONGO_URI` — connection string Atlas
   - `ADMIN_PASSWORD`, `DEMO_PASSWORD` — mật khẩu ≥ 10 ký tự
   - `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `SIM_MQTT_PASSWORD`
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (để trống nếu không dùng Telegram)
4. Bấm **Apply**. Render build và deploy.

**Cách B — tạo Web Service thủ công:**

| Trường trong Render | Giá trị |
|---|---|
| Runtime | Node |
| Build Command | `npm ci --include=dev --no-audit --no-fund && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/v1/health` |
| Region | `singapore` (gần Việt Nam nhất) |
| Plan | Free |

Biến môi trường cần thêm (xem `.env.example` và `render.yaml`):

```
NODE_VERSION=22.23.4
NODE_ENV=production
MONGOMS_DISABLE_POSTINSTALL=true
MONGO_URI=mongodb+srv://...
MONGO_DB=smart_energy
JWT_SECRET=<chuỗi ngẫu nhiên ≥ 32 ký tự>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<mật khẩu mạnh>
DEMO_PASSWORD=<mật khẩu mạnh>
SEED_DEMO=true
MQTT_URL=mqtts://<broker-host>:8883
MQTT_USERNAME=<tài khoản>
MQTT_PASSWORD=<mật khẩu>
SIM_MQTT_PASSWORD=<mật khẩu>
```

`JWT_SECRET` không cần nhập tay nếu dùng Blueprint — Render tự sinh bằng `generateValue: true`.

### 10.6. Vì sao build command phải có `--include=dev`

Render đặt `NODE_ENV=production` ngay cả khi build, khiến `npm ci` bỏ qua `devDependencies`. Mà `typescript` và `esbuild` đều nằm trong `devDependencies` — thiếu chúng thì `npm run build` lỗi với `TS2688: Cannot find type definition file for 'node'`.

`MONGOMS_DISABLE_POSTINSTALL=true` ngăn `mongodb-memory-server` tải binary MongoDB khoảng 100 MB trong lúc build (binary này chỉ dùng cho test tích hợp).

### 10.7. Kiểm tra sau khi deploy

| Địa chỉ | Nội dung |
|---|---|
| `https://<app>.onrender.com/` | Giao diện React |
| `https://<app>.onrender.com/docs` | Swagger UI |
| `https://<app>.onrender.com/api/v1/health` | Kiểm tra sức khoẻ, trả `{"status":"ok","mqtt":true}` |

Đăng nhập bằng `ADMIN_USERNAME` / `ADMIN_PASSWORD` đã khai trong Render.

Nếu `health` trả `"mqtt": false`, kiểm tra log: MQTT URL sai, thiếu username/password, hoặc broker chưa cấp quyền topic `campus/#`.

### 10.8. Nạp dữ liệu mô phỏng

Render không chạy `compose.yaml`, nên container `simulator` trong Compose không tồn tại trên cloud. Để có dữ liệu điện mô phỏng:

1. Chạy simulator từ máy local (cần Node 22), trỏ `MQTT_URL` về broker cloud:

```powershell
$env:MQTT_URL = "mqtts://<broker-host>:8883"
$env:MQTT_USERNAME = "<tài khoản>"
$env:MQTT_PASSWORD = "<mật khẩu>"
$env:SIM_MQTT_PASSWORD = "<mật khẩu>"
node scripts/simulator.mjs
```

2. Hoặc dùng API để nạp trực tiếp (cần token Admin):

```
POST https://<app>.onrender.com/api/v1/telemetry/ingest
Authorization: Bearer <access_token>
```

### 10.9. Giới hạn của bản Free

- Service ngủ sau **15 phút** không có truy cập; lần mở lại mất khoảng **1 phút** để khởi động lại.
- Hệ thống file tạm, mọi thay đổi cục bộ mất khi redeploy hoặc restart.
- Giới hạn 750 giờ chạy miễn phí mỗi tháng cho toàn workspace.
- Chỉ có 1 instance, không scale được.
- Dữ liệu nằm ở Atlas nên không mất khi service restart — nhưng chính sách của Atlas M0 có thể xoá cluster sau thời gian không hoạt động. Hãy sao lưu trước khi bàn giao.
- WebSocket của Socket.IO có thể bị đứt khi service ngủ; giao diện có polling 5 giây nên vẫn tự cập nhật.

## 11. Tài liệu kỹ thuật đã đối chiếu

- NestJS MongoDB: https://docs.nestjs.com/v11/techniques/mongodb
- NestJS Authentication: https://docs.nestjs.com/v11/techniques/authentication
- MongoDB TTL: https://www.mongodb.com/docs/v8.0/core/index-ttl/
- MongoDB time series indexes: https://www.mongodb.com/docs/manual/core/timeseries/timeseries-index/
- Render Blueprint: https://render.com/docs/blueprint-spec
- Render Node version: https://render.com/docs/node-version
- Render free tier: https://render.com/docs/free
- Render connect MongoDB Atlas: https://render.com/docs/connect-to-mongodb-atlas

`package-lock.json` khóa phiên bản package dùng trong bản bàn giao. Không chứa `.env`, mật khẩu thật hoặc `node_modules` trong gói mã nguồn.
