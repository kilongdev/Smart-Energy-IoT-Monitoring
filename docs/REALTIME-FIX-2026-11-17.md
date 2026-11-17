# Realtime A101 — chẩn đoán và bản sửa

Trạng thái: đã sửa code và môi trường local; **chưa xác nhận 3 chu kỳ Wokwi sau khi nạp firmware mới**.

## Bằng chứng và nguyên nhân

1. So sánh Git `91a5e2c → 65b5214` (redesign) và `65b5214 → d39e4b8` (các thay đổi tiếp theo): guard `loadingRequest.current` xuất hiện trong đợt sau. Event alert gọi cùng `load()` với dashboard, catalog, lịch và nhật ký. Khi load đang chạy, event bị bỏ qua; lần polling 5 giây sau mới tải lại. Không thể quy toàn bộ lỗi cho phần JSX redesign.
2. Máy chạy đồng thời Docker API và Node watch. Hai backend dùng MQTT client ID `smart-energy-backend`. Log Docker có các lần kết nối cách 4–6 giây và `Connection closed`. Đã dừng riêng `docker compose stop api`, giữ Node local. Sau đó health trả `status:ok,mqtt:true`. Không đổi client ID ngẫu nhiên để che việc chạy trùng.
3. Subscriber độc lập đã thấy A101 ngay tại EMQX: 17:07:53,799 nhận mẫu đo 17:07:30; 17:07:58,283 nhận mẫu đo 17:07:32. Uptime cũng chỉ tăng 2 giây, trong khi thời gian thực tăng khoảng 4,5 giây. Sau đó độ lệch vượt 30 giây và tăng liên tục. Đây là bằng chứng độ lệch đã có trước backend.
4. Sketch dùng `time(nullptr)` và chỉ gọi `configTime` ở setup, không cấu hình lại chu kỳ SNTP cho mô phỏng chạy chậm. Đã đặt SNTP 15 giây, callback xác nhận đồng bộ, timestamp millisecond; không publish khi chưa có đồng bộ mới. Phần tích phân điện năng vẫn chạy. Không đổi GPIO, thiết bị, broker/topic, ACK, ngưỡng hoặc thời gian phục hồi. Diagram giữ nguyên.

## File/hàm sửa

- `web/alert-refresh.ts`: hàng đợi refresh dành riêng cho cảnh báo. Giữ invalidation đến giữa request, bỏ response đã lỗi thời, chạy lượt đọc tiếp ngay. Background reload không gây starvation; dispose chặn response từ phiên đăng nhập cũ.
- `web/app.tsx`: listener alert và Socket.IO connect gọi refresh riêng ngay, không chờ dashboard/logs hoặc throttle 250 ms. Giữ các endpoint và polling dự phòng hiện có; không thêm polling. Lỗi endpoint khác không đặt lỗi tải cảnh báo.
- `src/mqtt.ts`, `src/telemetry.ts`: lấy receivedAt tại đầu handler MQTT, truyền vào ingest để đo đúng thời gian nhận trước validation/hàng đợi. Không sửa ACK.
- `src/realtime-trace.ts`, `src/alerts.ts`, `src/events.ts`: thêm log opt-in tại nhận MQTT, đánh giá, lưu sự cố và emit Socket.IO. Không log credentials/token/payload toàn phần.
- `wokwi/sketch.ino`: sửa riêng thời gian sau khi xác minh lệch tại nguồn.
- `test/domain.test.ts`: regression event đến giữa request, response cũ, disconnect/đọc lại, dispose, background load và lỗi request rồi hồi phục.

## Độ trễ đã đo / chưa đo

Subscriber Socket.IO kiểm tra đăng nhập qua API local. 20 mẫu A101 liên tiếp:

| Bước | Kết quả thực tế |
| --- | --- |
| Timestamp thiết bị → subscriber EMQX | Tăng từ 23,799 s lên hơn 141 s trên firmware cũ |
| Nest receivedAt → subscriber Socket.IO telemetry | Min 248 ms, max 870 ms, trung bình 371 ms |
| Hoàn tất sustain/recovery → DB lưu trạng thái | Chưa đo trong 3 chu kỳ firmware mới |
| DB save → Socket.IO alert | Đã có instrumentation; chưa đủ dữ liệu đo chu kỳ mới |
| Socket.IO alert → React render | Chưa đo trong trình duyệt thật; không dùng thời gian subscriber Node thay thế |
| Telegram | Chưa xác nhận 3 chu kỳ mới; không gửi tin/telemetry giả vào cloud |

Log thô kiểm tra nằm trong `.cache/realtime-observations.jsonl` (không chứa token). Đồng hồ độc lập có sai số, không dùng chênh lệch hai máy để suy ra độ trễ mạng một chiều chính xác.

## Kiểm tra

- `npm.cmd test`: 58/58 test đạt trong checkout hiện tại; build đạt. Test tự động không thay thế kiểm thử Wokwi thực tế.
- Typecheck frontend riêng còn 18 lỗi TS2339 có sẵn trong `web/HeatPlan.tsx`; không sửa ngoài phạm vi.
- Đối chiếu TypeScript AST: toàn bộ JSX trong app.tsx giữ nguyên (bỏ khác biệt CRLF/LF). CSS/diagram không đổi.
- Không có arduino-cli/PlatformIO trong môi trường. Firmware chưa được compile hoặc chạy trên Wokwi mới tại thời điểm báo cáo.
- Không push/deploy Render/production, không xóa dữ liệu, không sửa ngưỡng cloud.

## Bật trace và kiểm thử còn lại

1. Backend: đặt `REALTIME_TRACE=true` trong môi trường khởi chạy; dùng một backend duy nhất. Tắt flag sau đo để tránh log liên tục.
2. Console trình duyệt: `sessionStorage.setItem('energy-realtime-trace','true')`. Các mốc gồm `socket.received`, `alerts.fetch.start`, `alerts.state.commit`, `alerts.react.commit`. useEffect ghi mốc commit React, không cam kết thời điểm pixel được vẽ.
3. Chép sketch mới vào Wokwi, giữ cấu hình thiết bị hiện tại. Khởi động một lần để nạp firmware mới, kiểm tra Serial có `NTP synchronized`. Không reconnect trong 3 chu kỳ kiểm thử tiếp theo.
4. Thực hiện NORMAL → ACTIVE → RECOVERED ba lần, chờ đúng thời gian cấu hình và đối chiếu alert ID, trạng thái, Telegram cùng log timestamp. Chưa hoàn tất bước này thì không báo PASS end-to-end.

Tham khảo API SNTP và giới hạn chu kỳ 15 giây: [Espressif System Time](https://docs.espressif.com/projects/esp-idf/en/v5.0/esp32/api-reference/system/system_time.html).
