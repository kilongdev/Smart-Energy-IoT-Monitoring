# Kiểm tra vòng đời cảnh báo — 17/11/2026

## Kết quả truy vết B101 trên Atlas (chỉ đọc)

- Quy tắc đang mở: công suất > 4.000 W, duy trì 0 giây; phục hồi < 3.500 W liên tục 5 giây.
- Sự cố `7754b9b2-26f1-4943-ab35-d8bb93f4a58c` đang ACTIVE. Mẫu đánh giá cuối là 4.942,4 W, đo 11:27:52, nhận 11:28:21,985 (giờ Việt Nam).
- Gateway lưu 3.145,6 W, đo 11:29:21 nhưng nhận 11:31:15,137: trễ 114,137 giây.
- Mẫu này nằm trong vùng phục hồi nhưng vượt giới hạn độ trễ 30 giây; không đủ điều kiện thay đổi vòng đời cảnh báo. `processed:true` nghĩa là pipeline đã xử lý bản tin, không có nghĩa mẫu đã vượt qua kiểm tra freshness.
- Quy tắc đã được người dùng cập nhật lúc 11:30:42,724; saveRule đặt lại bộ đếm. Sự cố đang mở vẫn sử dụng snapshot điều kiện lúc phát sinh.
- Không tìm thấy cặp thiết bị/quy tắc có hơn một sự cố `isOpen:true` tại thời điểm kiểm tra.
- Chưa có bằng chứng phân biệt chính xác độ trễ do đồng hồ mô phỏng, truyền mạng hay chờ trước khi ingest. Không quy kết chỉ từ chênh lệch hai timestamp.

## Flow thực tế

1. MQTT kiểm tra DTO/topic; Telemetry.ingest lấy receivedAt, xếp hàng theo thiết bị, kiểm tra thiết bị và lưu mẫu. Timestamp trùng được khử trùng theo thiết bị/thời gian đo.
2. Telemetry.process cập nhật latest và phát telemetry trước khi đánh giá cảnh báo. Vì vậy gateway mới nhất và mẫu đánh giá sự cố có thể khác nhau; không lấy latest để tự kết luận RECOVERED trên frontend.
3. Alerts.evaluate chỉ nhận mẫu đủ mới: không tương lai quá 5 giây, không trễ quá 30 giây, không nằm trong hàng đợi quá 30 giây. Mutex theo thiết bị bảo vệ đánh giá; quy tắc độc lập được xử lý song song.
4. NORMAL/PENDING nằm trên rule. Chỉ vi phạm trong khung giờ và đủ thời gian duy trì mới tạo ACTIVE. Unique index bảo vệ một sự cố mở cho mỗi thiết bị/quy tắc.
5. ACTIVE dùng snapshot quy tắc. Không có ngưỡng phục hồi riêng thì đảo điều kiện phát hiện; có hysteresis thì cảnh báo cao cần nhỏ hơn ngưỡng phục hồi, cảnh báo thấp cần lớn hơn ngưỡng phục hồi. Các giới hạn cùng chỉ số cũng phải thỏa mãn.
6. Mẫu bình thường hợp lệ bắt đầu RECOVERING, sự cố vẫn mở. Bộ đếm dùng receivedAt, kiểm tra tính liên tục của cả thời gian đo và nhận (tối đa 5 chu kỳ gửi). Vi phạm lại hủy bộ đếm, giữ nguyên mã sự cố và trở về ACTIVE; không chờ phát hiện lại một sự cố đang mở.
7. Chỉ mẫu hợp lệ tiếp theo xác nhận đủ thời gian mới ghi RECOVERED, isOpen=false, ket_thuc_luc và thông báo phục hồi. Không dùng timer để tự kết luận phục hồi. Mất mẫu hoặc mẫu không hợp lệ làm gián đoạn phục hồi.
8. Socket.IO thông báo chuyển trạng thái; React tải lại API, có polling 5 giây dự phòng khi mất event. Telegram xử lý riêng với retry, thông báo phục hồi không ghi đè thông báo phát hiện đang gửi.

## Lỗi tái hiện và sửa trong đợt này

### `src/alerts.ts` — evaluateLocked

- Cursor lastMeasured/lastSample được cập nhật trước khi ghi sự cố. Test cố ý làm lần ghi sự cố thất bại: retry cùng mẫu bị bỏ qua và vẫn ACTIVE. Đã chuyển commit cursor xuống sau khi lưu sự cố thành công. Test thất bại trước sửa và qua sau sửa.
- Khi thiếu chỉ số, code xóa cursor, cho phép mẫu cũ đến sau khởi động phục hồi. Đã giữ cursor của bản tin mới, chỉ hủy bộ đếm và thông báo gián đoạn khi cần. Test thất bại trước sửa và qua sau sửa.
- snapshot.sample bị cập nhật liên tục nên không lưu riêng số đo phát hiện. Thêm snapshot.detectedSample bất biến cho sự cố mới, giữ snapshot.sample cho mẫu đánh giá gần nhất. Không sửa lịch sử cũ hoặc suy diễn lại giá trị đã mất. Test thất bại trước sửa và qua sau sửa.

### `web/app.tsx` — AlertPage; `web/alert-records.ts`

- KPI dùng activeAlerts nhưng danh sách ưu tiên history. Nếu phục hồi giữa hai request, KPI vẫn đếm trong khi hàng hiển thị đã phục hồi. Đã dùng cùng tập merged và cùng isAlertOpen cho KPI mở và danh sách. Bản ghi đã gộp không được coi là đang mở.
- Giữ nguyên layout, màu, component và các bộ lọc. Kiểm thử helper bao phủ trường hợp request trả trạng thái lệch thời điểm và bảo toàn chi tiết Telegram.

## Kiểm tra và giới hạn

- Build backend TypeScript và bundle frontend thành công.
- `npm.cmd test`: 56/56 test đạt sau sửa; ba regression về persistence/cursor/số đo phát hiện đã được chạy thất bại trước sửa.
- Bộ test gồm phát hiện, sustain, hysteresis, phục hồi bị ngắt, offline, timestamp trễ/trùng, sự cố mới sau phục hồi, nhiều thiết bị đồng thời, lỗi ghi rồi retry, Telegram và Command–ACK.
- Typecheck frontend toàn phần còn 18 lỗi TS2339 có sẵn ở web/HeatPlan.tsx; không sửa ngoài phạm vi.
- Test logic dùng MemoryStore; test MQTT dùng broker cục bộ và Telegram giả lập trong test. Chưa kiểm thử thao tác trình duyệt/reconnect Socket.IO hoặc lỗi mạng MongoDB Atlas thực tế bằng fault injection.
- Trên cloud chỉ đọc để đối chiếu; không sửa rule/ngưỡng, không xóa lịch sử, không migration hàng loạt. Backend đang chạy có thể tiếp tục ghi dữ liệu hoạt động bình thường.
- Wokwi sketch và diagram giữ nguyên, hash khớp hai file người dùng cung cấp. Không sửa EMQX/topic, Command–ACK hay trang khác.
- Độ trễ timestamp B101 chưa được khắc phục; không nới tiêu chí freshness hoặc dùng dữ liệu giả để làm cảnh báo trông như đã phục hồi.
