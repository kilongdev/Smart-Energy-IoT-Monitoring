# Đối chiếu báo cáo và lựa chọn triển khai

| Yêu cầu | Thành phần đáp ứng | Ghi chú |
|---|---|---|
| FR01 Thu thập | Telemetry, MQTT, DTO, unique index | Timestamp bắt buộc; loại lỗi, chống trùng, nhận dữ liệu gửi bù tối đa 30 ngày |
| FR02 Danh mục | Catalog, Users, JWT/RBAC | CRUD, ràng buộc cha–con, khóa user, giới hạn dữ liệu theo tòa nhà |
| FR03 Realtime | Socket.IO, dashboard, gauge/line | WebSocket có token, fallback tải lại dữ liệu 5 giây, online theo 3 chu kỳ |
| FR04 Heatmap/biểu đồ | Analytics, hourly, ECharts | Công suất W/kW, điện năng kWh; tổng hợp ngày/tuần/tháng |
| FR05 Quy tắc | Rules UI/API | Ngưỡng, giờ qua đêm, duy trì, cooldown, bật/tắt |
| FR06 Cảnh báo | Rule engine, Telegram worker | Gom cảnh báo mở, snapshot, log gửi, thử lại; Email chưa triển khai |
| FR07 Xử lý | Alerts API/UI | Mới → Đã xác nhận → Đã xử lý, lưu người/thời gian/ghi chú |
| FR08 Điều khiển | Control, MQTT, simulator | Lệnh có UUID, không retained, 5 giây timeout, ACK đúng mới thành công |
| FR09 Hẹn giờ | Schedules, schedule_runs | Giờ Việt Nam, kiểm tra từng giây, khóa lần chạy, không tự chạy bù |

## Chuyển TimescaleDB sang MongoDB

MongoDB không có `hypertable` và `continuous aggregate` theo nghĩa TimescaleDB. Bản này dùng collection thông thường để hỗ trợ unique index `(ma_thiet_bi, thoi_gian_do)` chắc chắn ở tầng DB, TTL 30 ngày và chỉ mục phục vụ truy vấn. Không tuyên bố collection này là MongoDB time-series collection.

| Collection | Mục đích |
|---|---|
| buildings, floors, rooms, devices | Cấu trúc tòa nhà và thiết bị; `buildingId` hỗ trợ lọc quyền |
| users | Hash bcrypt, vai trò, tòa nhà được cấp, tokenVersion |
| telemetry | Bản ghi thô, timestamp đo, timestamp nhận, cờ processed; TTL 30 ngày |
| dirty_hours | Các giờ cần tính lại khi có dữ liệu mới hoặc gửi bù |
| hourly | kWh và số mili giây có dữ liệu, tổng hợp theo thiết bị/giờ; giữ sau khi raw hết hạn |
| rules | Quy tắc và trạng thái theo dõi vi phạm, cooldown |
| alerts | Sự cố, snapshot, trạng thái nghiệp vụ, log xử lý/gửi Telegram |
| commands | Mã lệnh, trạng thái, deadline, ACK, ACK muộn, người thực hiện |
| schedules, schedule_runs | Lịch và khóa lần thực thi theo ngày/giờ; lịch sử lần chạy TTL 90 ngày |
| audit | Log quản trị và payload MQTT không hợp lệ; TTL 30 ngày |

Điện năng tính bằng tích phân hình thang giữa hai mẫu đo, theo **thời điểm đo**, không theo thời điểm nhận. Khoảng cách lớn hơn ba chu kỳ gửi bị bỏ qua để tránh phóng đại điện năng khi mất mạng. Mẫu đến trễ làm giờ liên quan được tính lại, không cộng dồn lần nữa. Kết quả là ước lượng từ công suất lấy mẫu, không phải thay thế công tơ đo điện năng tích lũy đã hiệu chuẩn. Thay đổi chu kỳ gửi có thể thay đổi tiêu chuẩn khoảng trống khi tính lại dữ liệu gần thời điểm chỉnh sửa.

Tổng hợp có độ trễ ngắn và xử lý tối đa 150 bucket mỗi lượt. Cần theo dõi backlog khi nạp nhiều dữ liệu lịch sử. Không có giả định khoảng trống dữ liệu tương đương tiêu thụ bằng 0. API trả thêm thời gian có dữ liệu để đối chiếu độ bao phủ.

## Điều chỉnh API so với ví dụ Chương 6

1. `POST /auth/login` giữ `tai_khoan`, `mat_khau` và trả `access_token`, `user`.
2. Telemetry thêm bắt buộc `thoi_gian_do`, `trang_thai_relay`; cần để chống trùng và đồng bộ trạng thái.
3. `POST /control/devices/:id/switch` chỉ nhận `hanh_dong`. Không nhận mã người dùng từ client để tránh giả mạo người thao tác.
4. API điều khiển trả **202** và bản ghi lệnh; đây là tiếp nhận yêu cầu, không phải xác nhận thành công. Kết quả thực thi ở WebSocket và `/control/logs`.
5. Mỗi lịch chỉ có **một giờ + một hành động**. Thay `gio_ket_thuc` bằng một lịch thứ hai. Ví dụ Tắt 18:00 T2–T6 và Bật 06:00 T3–T7 nếu muốn bật lại vào sáng hôm sau.
6. Lịch sử telemetry trả `{data,nextCursor}` (tối đa 1.000 mẫu/trang); range giới hạn 31 ngày. API tổng hợp trả `{data,unit,timezone,method,pendingBuckets}`; range tối đa 366 ngày và mốc tròn giờ, dạng `[from,to)`.
7. CRUD danh mục trả tối đa 1.000 bản ghi; cảnh báo/nhật ký lệnh trả tối đa 500 bản ghi mới nhất. Cần bổ sung phân trang đầy đủ nếu vận hành vượt quy mô đồ án.
8. Địa chỉ tòa nhà là tùy chọn theo từ điển dữ liệu Chương 5. Tên tòa nhà bắt buộc.
9. `Admin`, `QuanLy`, `NguoiXem` là enum trong API; giao diện hiển thị tiếng Việt.
10. Cooldown tính từ lần dành lượt gửi để cả lỗi Telegram cũng được giới hạn. Đây là lựa chọn triển khai khác với đề xuất tính từ lần gửi thành công trong đặc tả.

## Luồng triển khai

Telemetry MQTT → kiểm tra DTO/topic → ghi MongoDB chống trùng → cập nhật latest → đánh giá quy tắc → phát WebSocket → worker tổng hợp và gửi Telegram.

Nút điều khiển/lịch → kiểm tra quyền và online → lưu command → giữ một lệnh đang chờ/thiết bị → MQTT → ESP32/simulator → ACK → đối chiếu UUID/trạng thái → ghi kết quả → cập nhật giao diện.

Không mặc nhiên đưa nội dung báo cáo thành tuyên bố nghiệm thu. Các mốc trung bình ≤2 giây, Telegram ≤5 giây, truy vấn 30 ngày ≤3 giây và mất bản ghi <1% phải được đo trên môi trường demo thật.
