# Đề tài 19: Nền tảng IoT Giám sát Điện năng Tiêu thụ & Cảnh báo Sự cố Năng lượng Tòa nhà

**Smart Energy & Equipment IoT Monitoring Platform for Campus & Buildings**

Mô tả đề tài do người dùng cung cấp, được lưu làm tài liệu tham chiếu về mục tiêu, phạm vi chức năng và sản phẩm bàn giao của dự án. Công nghệ đã được người dùng chốt bên dưới được ưu tiên so với các đề xuất trong đề tài gốc.

## Công nghệ đã chốt cho dự án

- **MQTT broker:** EMQX, thay cho HiveMQ Cloud; giao thức truyền dữ liệu vẫn là MQTT.
- **Cơ sở dữ liệu:** MongoDB, thay cho các phương án TimescaleDB / InfluxDB trong đề tài gốc.

Đây là lựa chọn do người dùng xác nhận, làm căn cứ cho các bước phát triển và cấu hình tiếp theo.

## Mục tiêu & Tính cấp thiết

Hỗ trợ công tác quản trị cơ sở vật chất thông minh và tiết kiệm năng lượng tại các trường đại học, tòa nhà công sở; phát hiện kịp thời các sự cố chập điện, rò rỉ hoặc thiết bị tiêu thụ quá tải ngoài giờ làm việc.

## Yêu cầu chức năng chi tiết

### 1. Thu thập dữ liệu cảm biến đo đạc (Telemetry Ingestion)

Tiếp nhận luồng dữ liệu liên tục về công suất tiêu thụ (W, kW), điện áp, dòng điện và nhiệt độ từ các đồng hồ đo điện thông minh hoặc module vi điều khiển IoT thông qua giao thức MQTT.

### 2. Trực quan hóa mức độ tiêu thụ trên mặt bằng tòa nhà

Hiển thị bản đồ nhiệt (Heatmap) điện năng tiêu thụ theo từng phòng học, văn phòng, tầng lầu; biểu đồ so sánh công suất tiêu thụ theo chu kỳ ngày/tuần/tháng.

### 3. Tự động phát hiện bất thường & Cảnh báo

Thiết lập ngưỡng công suất định mức; hệ thống tự động phát hiện các hiện tượng bất thường (quên tắt thiết bị công suất cao vào ban đêm, điện áp trồi sụt nguy hiểm) và gửi tin nhắn cảnh báo tức thì qua Telegram Bot / Email ban quản lý.

### 4. Điều khiển thiết bị điện từ xa

Hỗ trợ nút bật/tắt thiết bị tập trung từ giao diện web hoặc hẹn giờ đóng ngắt nguồn điện tự động theo thời khóa biểu phòng học.

## Công nghệ & Công cụ đề xuất trong đề tài gốc

### Miễn phí

- **Giao thức IoT:** MQTT (sử dụng Broker đám mây miễn phí HiveMQ Cloud hoặc Eclipse Mosquitto Docker).
- **Thiết bị mô phỏng:** Phần mềm giả lập phần cứng trực tuyến Wokwi Simulator (kết nối ESP32 ảo) hoặc kit mạch thật ESP32.
- **Backend:** Node.js (NestJS) hoặc Python FastAPI.
- **CSDL chuỗi thời gian:** TimescaleDB (Extension trên PostgreSQL) hoặc InfluxDB Cloud Free.
- **Frontend:** React.js + Apache ECharts.

### Doanh nghiệp / Có phí

- Đồng hồ đo điện công nghiệp Modbus RTU Schneider/Siemens.
- Nền tảng AWS IoT Core.

## Sản phẩm bàn giao sau 12 tuần

Hệ thống kết nối hoàn chỉnh với module cảm biến ESP32 (thật hoặc mô phỏng qua Wokwi), truyền dữ liệu dòng điện thời gian thực lên web dashboard và kích hoạt cảnh báo Telegram thành công khi vượt ngưỡng tải.
