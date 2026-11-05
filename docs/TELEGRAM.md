# Cảnh báo Telegram

Luồng dữ liệu: ESP32 → EMQX (MQTT) → backend đánh giá quy tắc → lưu cảnh báo trong MongoDB → worker gửi Telegram. Broker MQTT không cần kết nối trực tiếp với Telegram.

## 1. Tạo bot và chọn nơi nhận

1. Mở [@BotFather](https://t.me/BotFather), dùng `/newbot` và làm theo hướng dẫn để lấy token.
2. Điền `TELEGRAM_BOT_TOKEN` vào `.env` ở thư mục gốc. Token chỉ dùng ở backend, không đưa vào frontend hoặc Git.
3. Nhắn `/start` cho bot để nhận tin cá nhân. Nếu nhận trong nhóm: thêm bot vào nhóm, cho phép bot gửi tin và nhắn `/start@ten_bot` trong nhóm.
4. Cài thư viện và build (yêu cầu Node.js 22 theo cấu hình dự án):

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run telegram -- chats
```

Lệnh `chats` hiển thị Chat ID từ các cập nhật gần đây; không tự chọn người nhận và không xác nhận/xóa cập nhật. Sao chép đúng ID của cuộc trò chuyện cần nhận vào `.env`, giữ nguyên dấu `-` nếu có:

```dotenv
TELEGRAM_BOT_TOKEN=token_tu_BotFather
TELEGRAM_CHAT_ID=-1001234567890
DASHBOARD_URL=https://dia-chi-dashboard-cua-ban
```

Nếu danh sách trống, gửi lại lệnh cho bot rồi chạy lại. Nếu bot đang dùng webhook, công cụ sẽ báo để lấy Chat ID từ ứng dụng xử lý webhook; không tự gỡ webhook.

## 2. Kiểm tra kết nối và gửi tin thử

```powershell
npm.cmd run telegram -- check
npm.cmd run telegram -- test
```

`check` xác minh bot và Chat ID mà không gửi tin. `test` gửi một tin có ghi rõ là kiểm tra kết nối đến Chat ID trong `.env`. Chỉ khi Telegram trả về mã tin nhắn hợp lệ mới báo thành công. Không cần chạy MongoDB/EMQX để dùng hai lệnh này.

Sau khi đổi `.env`, khởi động lại backend. Nếu chạy Docker, build lại để nhận mã nguồn mới và tạo lại container để nạp biến môi trường:

```powershell
docker compose up -d --build --force-recreate api
```

Nếu triển khai trên máy chủ, đặt hai biến môi trường tại máy chủ và khởi động lại dịch vụ tương ứng.

## 3. Thử cảnh báo từ dữ liệu thiết bị

1. Mở **Cảnh báo → Thêm quy tắc**, chọn thiết bị ESP32 đang gửi telemetry qua EMQX.
2. Đặt chỉ số `cong_suat_w`, toán tử `>`, ngưỡng `1000`, thời gian duy trì `10` giây, phục hồi `30` giây, nhắc lại `300` giây, bật quy tắc. Đây là số liệu mô phỏng, không phải ngưỡng áp dụng chung cho thiết bị thực tế.
3. Cho thiết bị mô phỏng gửi công suất `1600 W` liên tục, đúng chu kỳ gửi. Sau ít nhất 10 giây vi phạm, cảnh báo xuất hiện trên web và được xếp hàng gửi Telegram.
4. Kiểm tra tin gồm vị trí, thiết bị, số đo, ngưỡng, mức độ, thời gian đo theo giờ Việt Nam và mã cảnh báo. Cột **Telegram** trên web chuyển sang **Thành công** khi Telegram chấp nhận tin.
5. Cho công suất về trong khoảng cho phép: sự cố chuyển **Đang phục hồi**. Sau 30 giây có số đo bình thường liên tục, hệ thống tự đánh dấu **Đã phục hồi**, kết thúc sự cố và gửi một tin phục hồi cùng mã sự cố. Không có nút hoặc API xác nhận thủ công.

Tin phát hiện, tin nhắc và tin phục hồi có tiêu đề riêng, cùng mã sự cố, tên tòa/tầng/phòng, số đo và giờ Việt Nam. Nếu cấu hình `DASHBOARD_URL` (tùy chọn), tin có đường dẫn lọc sự cố trên dashboard; vẫn phải đăng nhập và có quyền truy cập. Địa chỉ này phải truy cập được từ điện thoại người nhận.

Với simulator đi kèm, có thể đặt `SIM_MODE=overload`, giữ relay bật rồi tạo lại container simulator để thử quá tải. Sau thử nghiệm đổi lại `SIM_MODE=normal` và tạo lại container simulator.

## 4. Hàng đợi và xử lý lỗi

- Hàng đợi, số lần thử và nhật ký gửi nằm trong collection `alerts` của MongoDB. `telegramMessageId` chỉ có giá trị sau khi gửi thành công; `lastDeliveryError` và `deliveryLog` hỗ trợ tra lỗi qua API lịch sử cảnh báo.
- Worker kiểm tra mỗi giây, gửi tối đa một tin mỗi lượt và cách ít nhất 3,1 giây giữa hai lượt gửi trong một tiến trình. Mỗi yêu cầu có timeout 5 giây.
- Mỗi lượt thông báo thử tối đa 3 lần, chờ 30 rồi 60 giây giữa các lần thử, không ngắn hơn `retry_after` Telegram trả về. Telemetry mới không ghi đè một lượt đang chờ/gửi lại. Nhắc sự cố còn tồn tại tối thiểu mỗi 300 giây; quy tắc cũ có cooldown thấp hơn cũng áp dụng mức tối thiểu này.
- Tin phục hồi nằm trong `recoveryNotification` của bản ghi cảnh báo và được tạo cùng thao tác kết thúc sự cố. Trạng thái gửi của tin này độc lập với tin phát hiện/nhắc; `deliveryLog.kind` phân biệt `detected`, `reminder`, `recovered`. Nếu gửi Telegram lỗi, sự cố vẫn được kết thúc đúng theo số đo và tin phục hồi được thử lại.
- Thiếu một trong hai biến: trạng thái **Chưa cấu hình**, không tiêu hao số lần thử. Sau khi cấu hình và khởi động lại, các thông báo còn hiệu lực được tiếp tục gửi, bao gồm tin phục hồi chưa gửi. Tin phát hiện/nhắc của sự cố đã kết thúc không gửi nữa.
- Một thông báo được giữ bằng lease trong MongoDB để tránh hai worker cùng lấy gửi; lease hết hạn sau 15 giây nếu worker dừng đột ngột. Triển khai **một tiến trình worker gửi Telegram** để duy trì giới hạn tốc độ cho chat chung; giới hạn tổng giữa nhiều tiến trình chưa được đồng bộ.
- Timeout sau khi Telegram đã nhận tin có thể dẫn đến tin trùng khi thử lại. Trạng thái **Thành công** xác nhận Telegram chấp nhận, không xác nhận người nhận đã đọc.
- Dùng một Chat ID vận hành chung được phép nhận dữ liệu toàn hệ thống. Chưa có định tuyến chat riêng theo tòa nhà/người dùng.

| Lỗi | Cách xử lý |
| --- | --- |
| 400 | Kiểm tra Chat ID, nhắn `/start`, kiểm tra quyền gửi tin. Nếu nhóm chuyển thành supergroup, dùng Chat ID mới được thông báo trong lỗi. |
| 401 | Kiểm tra lại token từ BotFather. |
| 403 | Bỏ chặn bot hoặc thêm lại bot và cấp quyền gửi tin trong nhóm. |
| 409 khi tra Chat ID | Bot có webhook hoặc tiến trình khác đang gọi `getUpdates`. Lấy ID từ tiến trình đó. |
| 429 | Worker tự chờ theo thời gian Telegram yêu cầu. |
| Timeout / lỗi mạng | Kiểm tra backend truy cập HTTPS tới `api.telegram.org`; worker sẽ thử lại. |

Đối chiếu giao thức: [Telegram Bot API](https://core.telegram.org/bots/api#sendmessage), [giới hạn gửi tin](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this).
