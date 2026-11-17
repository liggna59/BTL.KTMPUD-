# Tài liệu REST API

Mọi API trao đổi `application/json`, mã hóa UTF-8. Phản hồi luôn có trường `success`.

Mã lỗi dùng chung:

| HTTP | Khi nào | Body |
|---|---|---|
| `400` | Dữ liệu không hợp lệ / sai định dạng JSON | `{"success": false, "message": "Dòng 2: Đơn giá phải lớn hơn hoặc bằng 0"}` |
| `404` | Không tìm thấy bản ghi hoặc API | `{"success": false, "message": "Không tìm thấy hóa đơn HD_..."}` |
| `409` | Trùng tên mặt hàng trong thư viện | `{"success": false, "message": "Mặt hàng \"...\" đã có trong thư viện (mã PROD_001)"}` |
| `500` | Lỗi ghi file | `{"success": false, "message": "Lỗi hệ thống khi lưu dữ liệu: ..."}` |

---

## 1. Thư viện hàng hóa `/api/products`

### `GET /api/products`

```json
{
  "success": true,
  "data": [
    { "id": "PROD_001", "name": "Xi măng Hoàng Thạch PCB40", "unit": "bao",
      "cost_price": 75000, "selling_price": 95000, "created_at": "2026-11-16T08:00:00Z" }
  ],
  "total": 1
}
```

### `GET /api/products/:id`

Trả về `{"success": true, "data": Product}` hoặc `404`.

### `POST /api/products`

```json
{ "name": "Cát vàng xây dựng", "unit": "khối", "cost_price": 280000, "selling_price": 350000 }
```

Kiểm tra: `name`, `unit` không rỗng (khoảng trắng thừa được gộp); `cost_price ≥ 0` (bỏ trống = 0); `selling_price ≥ 0` (bắt buộc); tên không trùng mặt hàng đã có (không phân biệt hoa/thường) → nếu trùng trả `409`.

Phản hồi `201 Created`:

```json
{
  "success": true,
  "message": "Đã thêm mặt hàng thành công",
  "data": { "id": "PROD_1700123456", "name": "Cát vàng xây dựng", "unit": "khối",
            "cost_price": 280000, "selling_price": 350000, "created_at": "2026-11-17T10:00:00+07:00" }
}
```

Mã mặt hàng mới có dạng `PROD_<unix giây>`, tự tăng nếu trùng.

### `PUT /api/products/:id`

Cập nhật một phần: chỉ các trường được gửi mới bị thay đổi.

```json
{ "selling_price": 360000, "unit": "m3" }
```

Phản hồi `200`: `{"success": true, "message": "Đã cập nhật mặt hàng thành công", "data": Product}`.

### `DELETE /api/products/:id`

```json
{ "success": true, "message": "Đã xóa mặt hàng thành công" }
```

---

## 2. Hóa đơn `/api/invoices`

### `GET /api/invoices?search=&date=`

| Tham số | Ý nghĩa |
|---|---|
| `search` | Tìm theo tên khách hàng hoặc mã hóa đơn; không phân biệt hoa thường, gõ không dấu vẫn khớp (`minh` khớp "Anh Minh") |
| `date` | Lọc theo ngày lập `YYYY-MM-DD` (sai định dạng → `400`) |

Sắp xếp mới nhất lên đầu theo `created_at`.

```json
{
  "success": true,
  "data": [
    { "id": "HD_AnhMinh_20261116_0945", "customer_name": "Anh Minh (Công trình số 8)",
      "invoice_date": "2026-11-16", "total_amount": 950000, "items_count": 2,
      "created_at": "2026-11-16T09:45:12Z" }
  ],
  "total": 1
}
```

Bản tóm tắt có thêm `note` và `updated_at` khi có giá trị.

### `POST /api/invoices`

```json
{
  "customer_name": "Bác Hùng Thợ Điện",
  "invoice_date": "2026-11-16",
  "items": [
    { "line_number": 1, "product_name": "Aptomat Panasonic 32A", "unit": "cái", "quantity": 2, "unit_price": 125000 },
    { "line_number": 2, "product_name": "Dịch vụ lắp tủ điện tổng", "unit": "gói", "quantity": null, "unit_price": 300000 }
  ],
  "note": "Khách hẹn chiều lấy thêm dây"
}
```

Kiểm tra:
- `items` có ít nhất 1 dòng (tối đa 500).
- Mỗi dòng: `product_name` không rỗng; `unit_price` là số `≥ 0` (chấp nhận số hoặc chuỗi số).
- `quantity` là `null`, vắng mặt hoặc chuỗi rỗng → **bán khoán**: `is_lump_sum = true`, `total_price = unit_price`. Số lượng âm → `400`. Chấp nhận số thập phân (`1.5` hoặc `"1,5"`).
- `customer_name` trống → `"Khách lẻ"`; `invoice_date` trống → ngày hiện tại.

Xử lý phía server:
1. Tính lại `total_price` từng dòng và `total_amount` (bỏ qua mọi số tiền client gửi lên); `line_number` được đánh lại 1, 2, 3...
2. Sinh `amount_in_words` bằng tiếng Việt.
3. Sinh `id` = `HD_{TenKhachKhongDau}_{YYYYMMDD_HHmm}` theo giờ máy chủ. Phần trong ngoặc của tên khách được bỏ (`Anh Minh (Công trình số 8)` → `AnhMinh`). Trùng mã trong cùng phút → thêm hậu tố `_2`, `_3`.
4. Mặt hàng chưa có trong thư viện → tự thêm vào `products_data.json` (giá bán = đơn giá trên hóa đơn, giá vốn = 0, ĐVT trống → `cái`, hoặc `gói` nếu bán khoán).
5. Ghi nguyên tử vào `history_data.json`.

Phản hồi `201 Created` (các trường theo đặc tả + `synced_products`, `data` mở rộng):

```json
{
  "success": true,
  "message": "Đã lưu hóa đơn thành công",
  "invoice_id": "HD_BacHungThoDien_20261116_1015",
  "total_amount": 550000,
  "amount_in_words": "Năm trăm năm mươi nghìn đồng chẵn",
  "synced_products": [ { "id": "PROD_1763262900", "name": "Dịch vụ lắp tủ điện tổng", "unit": "gói", "cost_price": 0, "selling_price": 300000 } ],
  "data": { "...": "hóa đơn đầy đủ (Invoice)" }
}
```

### `GET /api/invoices/:id`

Trả về hóa đơn đầy đủ:

```json
{
  "success": true,
  "data": {
    "id": "HD_AnhMinh_20261116_0945",
    "customer_name": "Anh Minh (Công trình số 8)",
    "invoice_date": "2026-11-16",
    "items": [
      { "line_number": 1, "product_name": "Ống nhựa Tiền Phong D27", "unit": "cây", "quantity": 10,
        "unit_price": 45000, "total_price": 450000, "is_lump_sum": false },
      { "line_number": 2, "product_name": "Nhân công lắp đặt hoàn thiện", "unit": "gói", "quantity": null,
        "unit_price": 500000, "total_price": 500000, "is_lump_sum": true }
    ],
    "total_amount": 950000,
    "amount_in_words": "Chín trăm năm mươi nghìn đồng chẵn",
    "created_at": "2026-11-16T09:45:12Z"
  }
}
```

### `PUT /api/invoices/:id` *(mở rộng)*

Dùng cho chức năng **Nạp lại (Sửa) → Cập nhật hóa đơn**. Body giống `POST`. Giữ nguyên `id` và `created_at`, ghi thêm `updated_at`, tính lại toàn bộ số tiền và đồng bộ mặt hàng mới. Phản hồi `200` cùng cấu trúc với `POST`.

### `DELETE /api/invoices/:id`

```json
{ "success": true, "message": "Đã xóa hóa đơn HD_AnhMinh_20261116_0945" }
```

---

## 3. API mở rộng

### `GET /api/stats`

```json
{
  "success": true,
  "data": {
    "invoice_count": 128,
    "total_revenue": 158450000,
    "product_count": 42,
    "today": { "date": "2026-11-17", "invoice_count": 6, "revenue": 4350000 },
    "last_7_days": [ { "date": "2026-11-11", "revenue": 0, "invoice_count": 0 } ],
    "top_products": [ { "name": "Xi măng Hoàng Thạch PCB40", "unit": "bao", "quantity": 23, "revenue": 2185000, "lines": 2 } ],
    "lump_sum_lines": 12,
    "generated_at": "2026-11-17T13:00:00+07:00"
  }
}
```

### `GET /api/settings` · `PUT /api/settings`

Thông tin cửa hàng in trên đầu hóa đơn (`data/settings.json`):

```json
{
  "store_name": "CỬA HÀNG VẬT TƯ MINH PHÁT",
  "address": "Số 12 Lê Lợi, TP. Thanh Hóa",
  "phone": "0912 345 678",
  "invoice_title": "HÓA ĐƠN BÁN LẺ",
  "footer_note": "Cảm ơn quý khách đã mua hàng!"
}
```

### `GET /api/health`

`{"success": true, "time": "2026-11-17T13:00:00+07:00"}`: giao diện dùng để phát hiện mất / có lại kết nối.

---

## 4. Khóa đồng thời & ghi an toàn

- Mỗi file JSON có một `sync.RWMutex` riêng ([`internal/utils/file_storage.go`](../internal/utils/file_storage.go)). `GET` dùng `RLock()` (đọc song song), `POST`/`PUT`/`DELETE` dùng `Lock()` độc quyền.
- Ghi nguyên tử: ghi `*.json.tmp` → `fsync` → `rename` đè file chính (thử lại tối đa 10 lần nếu Windows đang khóa file).
- Dữ liệu được giữ trong bộ nhớ; chỉ cập nhật bộ nhớ sau khi ghi đĩa thành công.
- Kiểm thử `TestConcurrentInvoiceSaves` gửi 60 hóa đơn đồng thời và xác nhận file có đủ 60 bản ghi, không trùng mã.
