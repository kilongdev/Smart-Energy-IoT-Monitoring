# Tự xử lý sự cố theo dữ liệu đo

## Quy tắc vận hành

- Vi phạm liên tục đủ `thoi_gian_duy_tri` mới tạo sự cố. Mỗi quy tắc giữ một sự cố đang theo dõi, kể cả khi số đo dao động trong giai đoạn phục hồi.
- Khi chỉ số của sự cố về khoảng cho phép, chuyển `tinh_trang` sang **Đang phục hồi**. Sau `thoi_gian_phuc_hoi` (mặc định 30 giây) có các mẫu bình thường liên tục, chuyển sang **Đã kết thúc**, `trang_thai = Đã phục hồi`, `resolvedBy = system` và lưu `ket_thuc_luc`.
- Đây là kết luận từ số đo của chỉ số/quy tắc liên quan. Điện áp bình thường không tự đóng một sự cố công suất hoặc nhiệt độ còn vi phạm.
- Với cùng chỉ số trên cùng thiết bị, các điều kiện ngưỡng được kiểm tra cùng nhau khi xác định phục hồi. Ví dụ điện áp đang cao rồi chuyển xuống dưới ngưỡng thấp vẫn là bất thường.
- Sự cố lưu ngưỡng gốc và các điều kiện phục hồi trong snapshot. Nới ngưỡng hoặc tắt một quy tắc không xóa bằng chứng về sự cố đang theo dõi. Sửa quy tắc không tự đóng sự cố; tạm dừng quy tắc giữ nguyên sự cố và hiển thị rõ đang tạm dừng. Bật lại bắt đầu quan sát phục hồi từ đầu.
- Khung giờ áp dụng quyết định thời điểm tạo sự cố và nhắc lại. Sự cố đã phát hiện vẫn được theo dõi phục hồi ngoài khung giờ. Hết giờ mà thông số còn bất thường không được báo là bình thường.
- Mẫu trùng, sai thứ tự, thiếu chỉ số hoặc mẫu đo cũ gửi bù không chứng minh phục hồi. Khoảng cách giữa các mẫu vượt 5 chu kỳ gửi làm thời gian theo dõi liên tục bắt đầu lại; mất kết nối không tự đóng sự cố.
- API và giao diện không cung cấp thao tác xác nhận/đánh dấu đã xử lý. Endpoint cũ PATCH `alerts/history/:id/status` trả 404.

## Thông báo

1. **Phát hiện bất thường:** gửi khi tạo sự cố, ghi vị trí và số đo vi phạm.
2. **Nhắc sự cố chưa phục hồi:** cùng mã sự cố, số đo mới, thời gian đã theo dõi. Mặc định và tối thiểu cách nhau 300 giây; có thể cấu hình dài hơn. Không nhắc trong giai đoạn đang phục hồi hoặc khi quy tắc tạm dừng.
3. **Thông số đã phục hồi:** tạo một thông báo khi xác nhận chỉ số ổn định; ghi số đo phục hồi và thời gian yêu cầu. Nếu chỉ nhận được tin này sau một đợt mất kết nối Telegram, mã và thời điểm phát hiện vẫn giúp tra cứu sự cố.

Hai hàng đợi phát hiện/nhắc và phục hồi cùng nằm trong bản ghi MongoDB nhưng có mã lượt gửi và lease riêng. Tin phục hồi không ghi đè yêu cầu phát hiện đang gửi. Mạng mất sau khi Telegram đã nhận vẫn có thể dẫn đến tin trùng khi thử lại; không cam kết exactly-once.

## Dữ liệu cũ

Quy tắc chưa có `thoi_gian_phuc_hoi` dùng 30 giây. Cooldown dưới 300 giây được nâng lên 300 giây khi áp dụng. Sự cố chưa kết thúc được tiếp tục theo dõi từ mẫu mới, không phụ thuộc trạng thái xác nhận thủ công cũ. Không gửi lại tin phục hồi cho lịch sử đã kết thúc trước khi nâng cấp.

## Kiểm thử

`npm.cmd test` kiểm tra dao động quanh ngưỡng, mất dữ liệu, điện áp cao chuyển thấp, ra ngoài khung giờ, tạm dừng/bật lại quy tắc, nhắc lại và gửi phục hồi khi có yêu cầu đang chạy. `npm.cmd run test:integration` dùng MongoDB thật và MQTT cục bộ; Telegram được giả lập để không gửi tin tới người dùng.
