# Kết quả kiểm tra bản bàn giao

Ngày kiểm tra: 15/10/2026. Đây là kết quả quan sát trong môi trường xây dựng mã nguồn, không phải biên bản nghiệm thu trên máy triển khai.

## Đã thực hiện

| Hạng mục | Kết quả | Phạm vi |
|---|---|---|
| `npm run build` | Đạt | TypeScript backend và đóng gói React/ECharts bằng esbuild |
| `npm test` | 14/14 đạt, 0 lỗi | Domain, HTTP NestJS thật, MQTT TCP qua Aedes; MongoDB dùng test double |
| Đọc `compose.yaml` bằng YAML parser | Đạt | Cấu trúc YAML có 4 service; chưa xác nhận bằng Docker Engine |
| Swagger và trang chủ | HTTP kiểm thử đạt | Kiểm tra nội dung được phục vụ; chưa kiểm tra trình bày bằng trình duyệt |

Các tình huống đã đạt:

1. Khung giờ qua nửa đêm theo giờ Việt Nam và biên kết thúc.
2. Tích phân điện năng, cắt ở biên giờ và bỏ khoảng mất dữ liệu dài.
3. Online/offline theo ba chu kỳ, số đo 0 hợp lệ.
4. JWT, vai trò Admin/QuanLy/NguoiXem và phạm vi tòa nhà ở server.
5. CRUD, ràng buộc tham chiếu, PATCH giữ nguyên thuộc tính không gửi; từ chối chu kỳ `null`.
6. Telemetry hợp lệ, chống trùng timestamp và từ chối dữ liệu sai.
7. Nhận bản tin qua MQTT thật và chặn topic không thuộc thiết bị.
8. Debounce, cooldown, snapshot và chuyển trạng thái cảnh báo đúng thứ tự.
9. Lệnh trả 202 đang chờ; ACK đúng mới xác nhận thành công.
10. ACK sai mã bị bỏ qua; quá hạn thành thất bại; ACK muộn không xóa thất bại.
11. Thiết bị offline không được ghi thành công giả.
12. Lịch đến giờ thực hiện một lần; lịch tắt không chạy; chặn lịch xung đột.
13. Tính lại điện năng khi mẫu đến trễ, không cộng trùng.
14. Phục vụ Swagger và dashboard cùng API.

## Giới hạn của bằng chứng

`test/memory-store.ts` thay lớp lưu trữ MongoDB trong bộ test mặc định. Nó hỗ trợ các thao tác cần cho tình huống kiểm thử nhưng không mô phỏng đầy đủ MongoDB; phương thức aggregate của test double trả mảng rỗng. Vì vậy không dùng kết quả này để khẳng định TTL, chỉ mục MongoDB, biểu đồ tổng hợp qua pipeline thật, độ bền dữ liệu hoặc hiệu năng đã được kiểm chứng.

Đã thử `npm run test:integration` với MongoDB thật qua mongodb-memory-server. Tiến trình MongoDB kết thúc với mã 100, thông báo `open: Operation not permitted` trong bước initAndListen. Môi trường hiện tại chặn thao tác hệ điều hành mà MongoDB cần. Bộ integration test được giữ lại để chạy trên máy phù hợp.

Kiểm tra giao diện bằng Playwright chưa thực hiện được: không có browser binary; bước tải Chromium trả tệp không phải ZIP hợp lệ. Không có kết quả kiểm chứng trực quan hay thao tác giao diện end-to-end trong bản bàn giao này.

Chưa chạy Docker Compose/Mosquitto trong Docker, Telegram thật, biên dịch/nạp ESP32, bài tải 50 thiết bị/10 phút, hoặc đo thời gian truy vấn 30 ngày. Không có token Telegram thật trong mã nguồn; việc gửi thông báo cần cấu hình và kiểm tra tại môi trường của người dùng.

## Kiểm tra tiếp trên máy chạy dự án

1. Chạy `node scripts/setup.mjs` rồi `docker compose up --build -d`; kiểm tra các container healthy.
2. Theo mục 2 trong README: đăng nhập, xem số đo, điều khiển relay, đối chiếu ACK/nhật ký, tạo quy tắc và lịch.
3. Chạy `npm ci`, `npm test`, `npm run test:integration` trên máy có thể chạy MongoDB binary.
4. Thử các chế độ ACK lỗi, mất kết nối, gửi trùng trong README; kiểm tra dữ liệu vẫn còn sau khi khởi động lại container.
5. Cấu hình Telegram để kiểm tra nhận tin; chỉ chạy load test sau khi hệ thống cơ bản hoạt động.
