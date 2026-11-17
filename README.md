# Quản lý bán hàng và hóa đơn

Ứng dụng Windows dùng tại quầy vật tư bán lẻ. Giao diện tiếng Việt, dữ liệu lưu trên máy. Sau khi cài thư viện, ứng dụng chạy ngoại tuyến.

## Cài đặt và chạy

Cài Python 3.10 trở lên cho Windows, gồm Tcl/Tk và pip. Mở PowerShell trong thư mục có `main.py`, chạy lần lượt các lệnh sau.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe main.py
```

Nếu môi trường Python hiện tại đã có các thư viện trong `requirements.txt`, chạy trực tiếp `python main.py`.

## Lập hóa đơn đầu tiên

1. Trong **Thư viện hàng hóa**, bấm **Nhập từ Excel** và chọn `sample_products.xlsx`. Bảng mẫu có 10 vật tư với giá minh họa. Trang tính đang hoạt động cần có hàng tiêu đề đầu tiên gồm Tên hàng, Đơn vị tính, Giá bán và Giá gốc. Có thể đổi thứ tự cột, bỏ dấu hoặc đổi hoa thường. Dòng thiếu dữ liệu hợp lệ sẽ được đếm vào số dòng bỏ qua.
2. Mở **Hóa đơn**, nhập khách hàng và ngày chốt theo dạng ngày/tháng/năm. Chọn một mặt hàng để điền đơn vị và đơn giá hoặc gõ tên hàng mới. Nhập ngày xuất của dòng, rồi nhấn **Enter** hoặc **Thêm dòng**.
3. Nhập giá bằng đồng nguyên, chẳng hạn `12500` hoặc `12.500`. Số lượng có thể là `1,5` hoặc `1.5`. Để trống số lượng cho hàng khoán. Thành tiền được làm tròn đến đồng gần nhất cho từng dòng, phần lẻ từ nửa đồng được làm tròn lên.
4. Chọn một dòng để sửa, rồi bấm **Cập nhật dòng** hoặc **Enter**. Kéo dòng sang vị trí khác để đổi thứ tự. **Ctrl+Z** khôi phục tối đa 50 lần thay đổi dòng trên hóa đơn. Thư viện vẫn giữ đơn giá nhập gần nhất và giá gốc hiện có.
5. Bấm **Lưu hóa đơn** để ghi lịch sử. **Xuất Word** và **Xuất Excel** xuất bản đang hiển thị, kể cả trước lần lưu đầu. Lưu lại hóa đơn đang mở cập nhật cùng mã. Bấm **Làm mới** khi bắt đầu đơn khác. Các đơn mới trùng tên khách và phút lập có hậu tố riêng.
6. Trong **Lịch sử đơn hàng**, tìm theo mã, khách hoặc ngày chốt. Chọn hóa đơn để xem chi tiết, rồi bấm **Tải lên hóa đơn** để sửa. **Xóa** xóa bản lưu và thử xóa cả hai tệp đã xuất. Windows có thể giữ lại tệp đang mở.
7. Trong thư viện, **Thêm** cũng cập nhật giá nếu tên đã có. Chọn một hàng và dùng **Cập nhật** để sửa hoặc đổi tên. Lợi nhuận hiển thị là chênh lệch giá bán và giá gốc của một đơn vị.

## Dữ liệu và mã nguồn

Bên cạnh chương trình, `app_data/products_data.json` lưu thư viện và `app_data/history_data.json` lưu lịch sử bằng UTF-8. Tệp Word và Excel nằm trong `hoa_don_xuat/`. Cả hai thư mục được tạo tự động và cần có quyền ghi. Nếu tệp xuất đang mở, đóng tệp rồi xuất lại.

- `ui/` chứa ba tab Tkinter và các thành phần giao diện dùng chung.
- `services/` kiểm tra dữ liệu, tính tiền, đọc số tiếng Việt và điều phối các thao tác.
- `data/` đọc, ghi JSON và xử lý tệp Office. Tệp mới được ghi vào vị trí tạm trước khi thay thế tệp đích.
- `tests/` kiểm tra tính tiền, mã hóa đơn, hoàn tác, lưu và nạp lại, nhập Excel và kết quả xuất.

## Kiểm thử

```powershell
.\.venv\Scripts\python.exe -m unittest discover -v
```

Các bài kiểm thử dùng thư mục tạm riêng.

## Chạy bản EXE

Giải nén gói `QuanLyBanHang-Windows.zip` vào thư mục có quyền ghi, rồi mở
`QuanLyBanHang.exe`. Máy sử dụng bản EXE có thể chạy ngay mà không cần cài Python.
Dữ liệu được tạo trong `app_data/` cạnh EXE, hóa đơn xuất nằm trong `hoa_don_xuat/`.
Khi chuyển sang máy khác, chép cả hai thư mục này cùng EXE để mang theo dữ liệu.

Để tự đóng gói từ mã nguồn, cài công cụ build rồi chạy lệnh sau trong PowerShell.

```powershell
.\.venv\Scripts\python.exe -m pip install PyInstaller
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Kết quả nằm trong `dist/`. Gói phát hành gồm EXE, hướng dẫn và bảng hàng mẫu.

## Thao tác nhanh

- Gõ tên hàng không dấu rồi mở danh sách gợi ý bằng phím mũi tên xuống.
- Đơn giá hỗ trợ `20k` tương đương 20.000 đồng, `1,5tr` tương đương 1.500.000 đồng.
- Thành tiền của dòng đang nhập hiển thị ngay dưới ô nhập.
- **F2** bắt đầu nhập dòng mới, **Ctrl+S** lưu hóa đơn, **Ctrl+Z** hoàn tác.
- Khi đóng ứng dụng hoặc làm mới hóa đơn có nội dung chưa lưu, ứng dụng hỏi xác nhận.

