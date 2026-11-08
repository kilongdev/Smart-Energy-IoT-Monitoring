# MongoDB Atlas

Database hiện tại ở Atlas. Chỉ backend/frontend chạy trên máy.

## Cấu hình duy nhất

```dotenv
MONGO_URI=mongodb+srv://USERNAME:PASSWORD@YOUR_CLUSTER.mongodb.net/smart_energy?retryWrites=true&w=majority
MONGO_DB=smart_energy
```

Dùng `MONGO_URI` cho cả Docker, Node trực tiếp, kiểm tra Atlas và hosting.
Không còn `ATLAS_MONGO_URI` hay mật khẩu MongoDB local trong env.
`compose.yaml` chỉ chạy API, `compose.cloud.yaml` là alias của cấu hình này.

```powershell
npm.cmd run atlas:check
docker compose up -d --build api
```

Atlas cần Database User có quyền đọc/ghi database và IP máy backend nằm trong
IP Access List. Khi đổi mạng, kiểm tra IP public mới nếu kết nối thất bại.
Mật khẩu có ký tự đặc biệt phải URL-encode trong URI. Không đưa URI chứa mật khẩu
vào mã nguồn hoặc commit. Web tại localhost không tự trở thành web public khi dùng Atlas.

## Dữ liệu đã chuyển và sao lưu

Dữ liệu đã chuyển, giữ nguyên mã thiết bị, phòng và tài khoản. Không chạy lại migration.
Bản sao lưu BSON nằm trong `.cache/mongo-backups/`, bị loại khỏi Git và Docker image.
Volume MongoDB cũ được giữ để phục hồi; không còn là database vận hành.
Các container MongoDB/Mosquitto/simulator cũ đã được dọn; không còn tự khởi động.

`scripts/migrate-atlas.mjs` chỉ là công cụ chuyển dữ liệu thủ công: nguồn phải cung cấp
riêng qua `MIGRATION_SOURCE_URI`, đích là `MONGO_URI`. Không có URI nguồn mặc định.
Cần dừng mọi tiến trình ghi nguồn rồi chạy với `--api-stopped`. Đích phải chưa có
collection. Script giữ kiểu BSON/ID/chỉ mục và so sánh số lượng cùng SHA-256 từng
collection. Nếu lỗi giữa chừng, backup và đích có thể chưa đầy đủ; không tự xóa đích
hoặc chạy lại. Chỉ kết luận xong khi có `verified.json` và lệnh thoát thành công.

Tài liệu Atlas: https://www.mongodb.com/docs/atlas/connect-to-database-deployment/
