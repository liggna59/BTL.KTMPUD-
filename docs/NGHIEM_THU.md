# Biên bản kiểm thử nghiệm thu (Definition of Done)

- **Ngày kiểm thử:** 17/11/2026
- **Phiên bản:** 1.0.0 (`bin/BTKTPMUD.exe`, build bằng Go 1.27.4, `go.mod` yêu cầu Go ≥ 1.22)
- **Môi trường:** Windows 11, Microsoft Edge (headless, điều khiển bằng Playwright), Node.js 24
- **Cách kiểm thử:** tự động hoàn toàn bằng [`tests/e2e/e2e.mjs`](../tests/e2e/e2e.mjs): khởi động server thật trên bản sao dữ liệu mẫu, thao tác như thu ngân (gõ phím, bấm nút, phím tắt), đối chiếu giao diện với API và file JSON trên đĩa. Chạy lại: `cd tests/e2e && npm install && npm test`.

## Kết quả 15 tiêu chí theo đặc tả

| STT | Hạng mục | Tiêu chí đạt | Kết quả | Bằng chứng kiểm thử |
|---|---|---|---|---|
| TC01 | Khởi chạy ứng dụng | Mở `http://localhost:8080`, hiển thị ngay tab "Lập Hóa Đơn" | ✅ PASS | Tab đang mở = `invoice` ngay sau khi tải trang. Exe tự mở trình duyệt khi khởi động. |
| TC02 | Autocomplete vật tư | Gõ "Ống" → gợi ý các loại ống; chọn → tự điền ĐVT và Đơn giá | ✅ PASS | 12 gợi ý, 5 đầu đều là "Ống…"; chọn bằng `↓` `Enter` → ĐVT `cây`, giá `36.000`, con trỏ nhảy sang ô Số lượng. |
| TC03 | Tính thành tiền chuẩn | SL 5 × Đơn giá 20.000 → 100.000 đ | ✅ PASS | Thành tiền hiện `100.000` ngay khi gõ; đơn giá tự định dạng `20.000` khi rời ô. |
| TC04 | Nghiệp vụ bán khoán | Để trống SL, Đơn giá 350.000 → Thành tiền 350.000, không báo lỗi | ✅ PASS | Thành tiền `350.000`, gắn nhãn "Khoán"; server lưu `quantity: null`, `is_lump_sum: true`. |
| TC05 | Tổng tiền & đọc chữ | 3 mặt hàng → tổng cộng dồn đúng; bằng chữ chuẩn có "đồng chẵn" | ✅ PASS | `640.000 đ` – "Sáu trăm bốn mươi nghìn đồng chẵn". 33 ca đọc số dùng chung cho Go và JS đều đạt. |
| TC06 | Hoàn tác (Ctrl+Z) | Xóa nhầm dòng / sửa nhầm giá → Hoàn tác khôi phục đúng | ✅ PASS | Xóa dòng 2 → `Ctrl+Z` → đủ 3 dòng; sửa giá thành 99999 → `Ctrl+Z` → về 20.000, tổng về 640.000; nút "Hoàn tác" cũng hoạt động. |
| TC07 | Lưu hóa đơn & tự đồng bộ | Hàng mới chưa có trong kho → lưu → xuất hiện ngay ở tab Thư Viện | ✅ PASS | Mã `HD_AnhTestE2E_YYYYMMDD_HHmm`; thư viện 42 → 43 mặt hàng; hàng mới hiện trong bảng Thư viện (nhãn "Mới"). |
| TC08 | In hóa đơn A4 | Mở hộp thoại in, trang in sạch, ẩn menu, lề A4, có ngày tháng và chữ ký | ✅ PASS | `window.print()` được gọi; khi in `#app` bị ẩn, chỉ còn phiếu in Times New Roman; PDF xuất ra đúng khổ 210 × 297 mm, 1 trang, có "Ngày … tháng … năm …", ô ký Khách hàng / Người bán hàng. |
| TC09 | Thêm mới vật tư | Thêm vật tư → tự tính lãi gộp và tỷ lệ lãi % → lưu thành công | ✅ PASS | Giá vốn 45.000, giá bán 60.000 → lãi `15.000 đ`, tỷ lệ `33,33%`; API trả mặt hàng mới. |
| TC10 | Tìm kiếm danh mục | Gõ từ khóa → lọc tức thời, không giật lag | ✅ PASS | "keo silicon" → 1 dòng sau ~290 ms (gồm debounce 200 ms); gõ không dấu "ong nhua" → 5 dòng. |
| TC11 | Tra cứu lịch sử | Tìm theo tên KH / lọc theo ngày → đúng các đơn khớp | ✅ PASS | Theo tên "test e2e" → 1 đơn; theo mã "HD_ChiLan" → 1 đơn; ngày 15/11/2026 → 1 đơn; "Tất cả" → đủ 5 đơn. Nút Xem mở popup chi tiết. |
| TC12 | Nạp lại hóa đơn cũ | Bấm "Nạp lại" → chuyển tab Lập hóa đơn, nạp đủ hàng để sửa | ✅ PASS | Nạp 3 dòng (giữ dòng bán khoán), tên khách đúng, hiện thanh "Đang sửa hóa đơn"; sửa SL → "Cập nhật hóa đơn" giữ nguyên mã, tổng mới 735.000. |
| TC13 | Thống kê nhanh | Đúng tổng số hóa đơn, tổng doanh thu, tổng số mặt hàng | ✅ PASS | 3 thẻ khớp `/api/stats` (5 đơn · 6.694.000 đ · 44 sản phẩm); biểu đồ có tooltip khi rê chuột. |
| TC14 | Khóa đồng thời | 2 tab cùng lưu → file JSON không bị ghi đè / mất dữ liệu | ✅ PASS | 2 tab bấm Lưu cùng lúc + 30 request đồng thời: 5 → 37 hóa đơn, không trùng mã, cả 2 file JSON đọc lại hợp lệ. Thêm test Go 60 request đồng thời. |
| TC15 | Ngoại tuyến | Ngắt mạng / backend → vẫn nạp dữ liệu từ LocalStorage, không treo | ✅ PASS | Tắt hẳn server rồi tải lại trang: trang vẫn mở (Service Worker), nhãn "Ngoại tuyến", gợi ý hàng từ bộ nhớ máy; lưu hóa đơn → lưu tạm + cờ vàng; bật lại server → tự đồng bộ, hóa đơn có trên máy chủ. |

**Tổng kết: 15/15 tiêu chí đạt.**

## Kiểm tra bổ sung

| Mã | Nội dung | Kết quả |
|---|---|---|
| VAL | Lưu dòng thiếu tên hàng → báo lỗi, tô đỏ dòng, không gửi lên server | ✅ PASS |
| MOB | Màn hình điện thoại 390 px: cả 4 tab không tràn ngang | ✅ PASS |
| SET | Cấu hình thông tin cửa hàng in trên hóa đơn | ✅ PASS |
| ERR | Không phát sinh lỗi JavaScript trong toàn bộ phiên kiểm thử | ✅ PASS |

## Kiểm thử đơn vị

| Bộ test | Lệnh | Kết quả |
|---|---|---|
| Backend Go: CRUD sản phẩm, validation, bán khoán, tự đồng bộ thư viện, sinh mã HĐ, tìm kiếm/lọc, cập nhật/xóa, 60 request đồng thời, ghi nguyên tử, nạp lại file sửa tay, sao lưu | `go test ./internal/...` | 21/21 PASS |
| Thuật toán client: tính thành tiền, đọc số (bộ dữ liệu dùng chung với Go), Undo 50 bước, phân tích giá gõ nhanh, tìm không dấu | `node --test "tests/js/*.test.js"` | 10/10 PASS |
