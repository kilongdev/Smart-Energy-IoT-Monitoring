# Báo cáo kiểm tra trước khi push

Ngày kiểm tra: **08/11/2026**, trên workspace hiện tại. Kết quả này không phải
cam kết hiệu năng hoặc nghiệm thu phần cứng thực tế.

| Kiểm tra | Kết quả | Phạm vi |
|---|---|---|
| Build | Đạt | TypeScript backend và đóng gói React |
| Type-check frontend | Đạt | TypeScript kiểm tra riêng web/app.tsx |
| npm test | 36/36 đạt | Domain, vòng đời cảnh báo, Telegram mock, HTTP/MQTT; DB dùng test double |
| Integration MongoDB | 16/16 đạt | MongoDB 8.0.5 tạm, HTTP NestJS, MQTT qua Aedes, Telegram mock |
| Compose mặc định và alias cloud | Đạt | docker compose config --quiet; không restart dịch vụ |
| Setup/env | Đạt | Setup không ghi đè env cũ; đủ các key trong env mẫu |
| Git diff --check | Đạt | Không có lỗi whitespace trong working tree và index khi kiểm tra |

Integration chạy bằng binary đã cache:

```powershell
$env:MONGOMS_DOWNLOAD_DIR = "$PWD/.cache/mongodb-binaries"
node --test --test-concurrency=1 dist/test/integration.test.js
```

Sau khi sửa mã nguồn, build lại trước khi chạy lệnh này. Lệnh đầy đủ cho máy mới:
`npm run test:integration` (có thể cần tải MongoDB binary).

## Các tình huống được kiểm tra

- Phân quyền tòa nhà; CRUD và từ chối dữ liệu sai.
- Chuông chỉ hiển thị cảnh báo mở trong phạm vi được phép.
- Thêm ESP không bắt buộc MAC/topic, vẫn kiểm tra MAC được nhập và tự tạo topic riêng.
- Telemetry trùng timestamp, payload sai và topic giả mạo.
- Cảnh báo, debounce, phục hồi ổn định, chống nhắc quá dày và thử lại Telegram.
- ACK đúng/sai mã, sai relay, mất ACK thành Chưa xác định, ACK muộn, timestamp lệch và loi null.
- Telemetry không được suy diễn thay cho ACK; ACK trùng không ghi đè relay.
- Lịch không tạo lệnh trùng; tổng hợp điện năng tính lại khi mẫu đến trễ.
- Swagger và trang chủ được phục vụ cùng API.

## Kiểm tra trước khi commit

Đã quét file được track ở cả working tree và index, đối chiếu các secret đang có
trong env và các mẫu URI/token thông dụng: chưa phát hiện giá trị bí mật thật.
Đây không phải chứng nhận toàn bộ lịch sử Git không có secret.

Env, env backup, .cache, firmware/src/config.h và firmware/.pio được ignore.
Secret đã từng chia sẻ hoặc từng commit vẫn cần thay mới; xóa ở commit hiện tại
không tự xóa khỏi lịch sử. Kiểm tra staged diff trước khi push.

## Chưa được chứng minh bởi lần chạy này

- Hiệu năng hàng triệu document, tải 50 thiết bị hoặc độ trễ p95.
- Kết nối phần cứng thật, biên dịch firmware hoặc xác minh relay vật lý.
- Kiểm thử giao diện bằng trình duyệt end-to-end.
- Nhận Telegram thật, MQTT EMQX thật hoặc deploy Render trong lần rà soát này.
- Test double không chứng minh TTL, unique index và aggregation MongoDB; dùng bộ integration cho hành vi MongoDB thật.
