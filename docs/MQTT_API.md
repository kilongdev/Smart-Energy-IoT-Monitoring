# MQTT và API

## Topic

Topic gốc lưu ở `devices.chu_de_mqtt`. Ba thiết bị demo dùng `campus/demo/device1`, `device2`, `device3`.

| Topic | Nguồn → đích | QoS | Retain |
|---|---|---|---|
| `{base}/telemetry` | Thiết bị → backend | 1 | false |
| `{base}/command` | Backend → thiết bị | 1 | false |
| `{base}/ack` | Thiết bị → backend | 1 | false |
| `{base}/config` | Backend → thiết bị | 1 | true |

Backend đối chiếu topic và mã thiết bị trong payload. Broker chặn kết nối ẩn danh. Tài khoản `energy_sim` chỉ được publish telemetry/ACK và đọc command/config trong `campus/demo/+`. Vì các thiết bị demo dùng chung tài khoản, đây là ACL theo nhóm demo; thiết bị triển khai thật phải dùng credential riêng và ACL cho đúng topic.

## Telemetry

```json
{
  "ma_thiet_bi": "44444444-4444-4444-8444-444444444444",
  "thoi_gian_do": "2026-10-15T08:00:00.000Z",
  "cong_suat_w": 620.5,
  "dien_ap_v": 220.4,
  "dong_dien_a": 2.81,
  "nhiet_do_c": 37.1,
  "trang_thai_relay": true
}
```

Thay timestamp trong ví dụ bằng thời gian thực. Một thiết bị phải có tối đa một mẫu tại một timestamp, độ phân giải mili giây. Gửi lại giữ nguyên timestamp để nhận diện trùng. Nhiều kênh đo cùng thiết bị cần mở rộng định danh mẫu trước khi triển khai.

Payload MQTT tối đa 4 KB; kiểu số phải là JSON number, relay phải là boolean. Công suất 0–10.000.000 W, điện áp 0–1.000 V, dòng 0–10.000 A, nhiệt độ -40–200°C; đây là giới hạn tiếp nhận tổng quát, còn ngưỡng vận hành cấu hình bằng rules. Không nhận mẫu quá 30 ngày hoặc tương lai quá 5 giây. Không nhận bản tin telemetry/ACK retained.

## Command và ACK

```json
{
  "ma_lenh": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "ma_thiet_bi": "44444444-4444-4444-8444-444444444444",
  "hanh_dong": "Tắt",
  "het_han": "2026-10-15T08:00:05.000Z"
}
```

```json
{
  "ma_lenh": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "ma_thiet_bi": "44444444-4444-4444-8444-444444444444",
  "trang_thai_relay": false,
  "thoi_gian": "2026-10-15T08:00:01.000Z"
}
```

ACK có thể có trường `loi` (chuỗi). Thiết bị phải đặt trạng thái cụ thể, không dùng toggle; từ chối lệnh đã hết hạn; nhận lệnh trùng thì gửi lại ACK. Simulator giữ cache mã lệnh gần nhất; firmware demo giữ lệnh gần nhất. Chưa có bộ nhớ chống trùng bền vững qua reboot của thiết bị.

ACK sai thiết bị/topic/mã lệnh không hoàn tất lệnh. ACK báo relay không khớp ghi Thất bại. ACK muộn lưu riêng, không sửa kết quả timeout; chỉ đồng bộ trạng thái nếu thuộc lệnh mới nhất và không cũ hơn số đo relay đã có. Thời hạn 5 giây tính từ lúc backend tạo lệnh; bao gồm thời gian publish.

## Config

```json
{"chu_ky_gui": 5}
```

Đổi chu kỳ trên màn hình quản trị sẽ publish config. Simulator và firmware mẫu nhận config; thiết bị tự viết phải triển khai cùng topic này. Backend gửi lại cấu hình sau khi kết nối MQTT. Có thể đọc trạng thái quan sát qua `GET /devices`.

## REST chính

Tất cả dưới `/api/v1`; trừ login/health, cần header `Authorization: Bearer <access_token>`.

| Phương thức và route | Vai trò |
|---|---|
| POST auth/login | Công khai, có giới hạn tần suất |
| GET auth/me | Đã đăng nhập |
| GET buildings, floors, rooms, devices | Các vai trò, giới hạn phạm vi |
| POST/PATCH/DELETE buildings, floors, rooms, devices | Admin |
| GET/POST/PATCH/DELETE users | Admin |
| GET dashboard, rooms/:id/heatmap | Các vai trò |
| POST telemetry/ingest | Admin, cổng kiểm thử có xác thực |
| GET telemetry/device/:id/history?from=&to=&cursor= | Các vai trò |
| GET analytics/energy?from=&to=&period=day | Các vai trò |
| GET/POST alerts/rules; PATCH alerts/rules/:id | Admin/Quản lý |
| GET alerts/history?ma_phong=&muc_do=&trang_thai=&from=&to= | Admin/Quản lý |
| PATCH alerts/history/:id/status | Admin/Quản lý |
| POST control/devices/:id/switch | Admin/Quản lý |
| GET control/logs, control/runs | Admin/Quản lý |
| GET/POST control/schedules; PATCH/DELETE control/schedules/:id | Admin/Quản lý |
| GET audit | Admin |

Socket.IO nhận `{auth:{token:access_token}}`. Sự kiện `telemetry` cho các vai trò trong cùng tòa nhà; `alert` và `command` chỉ Admin/Quản lý. Không truyền JWT trong URL.

Mở Swagger, gọi login, copy `access_token`, bấm **Authorize** và dán token (không cần thêm chữ Bearer nếu Swagger đã hiển thị loại Bearer).
