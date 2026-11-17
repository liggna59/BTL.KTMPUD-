package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"btktpmud/internal/models"
)

type testEnv struct {
	t       *testing.T
	app     *App
	handler http.Handler
	dir     string
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	dir := t.TempDir()
	app, err := NewApp(dir)
	if err != nil {
		t.Fatal(err)
	}
	loc := time.FixedZone("ICT", 7*3600)
	app.Now = func() time.Time { return time.Date(2026, 11, 16, 10, 15, 30, 0, loc) }
	web := fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>test</title>")}}
	return &testEnv{t: t, app: app, handler: app.Routes(web), dir: dir}
}

func (e *testEnv) do(method, path string, body any) (int, map[string]any) {
	e.t.Helper()
	var reader *bytes.Reader
	switch b := body.(type) {
	case nil:
		reader = bytes.NewReader(nil)
	case string:
		reader = bytes.NewReader([]byte(b))
	default:
		raw, _ := json.Marshal(b)
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil && strings.HasPrefix(path, "/api/") {
		e.t.Fatalf("%s %s: phản hồi không phải JSON: %s", method, path, rec.Body.String())
	}
	return rec.Code, out
}

func (e *testEnv) products() []models.Product {
	var list []models.Product
	e.app.Products.View(func(v []models.Product) { list = append(list, v...) })
	return list
}

// ---------------------------------------------------------------------------
// Thư viện hàng hóa
// ---------------------------------------------------------------------------

func TestProductCRUD(t *testing.T) {
	e := newTestEnv(t)

	code, res := e.do("POST", "/api/products", map[string]any{
		"name": "  Cát vàng   xây dựng ", "unit": "khối", "cost_price": 280000, "selling_price": 350000,
	})
	if code != http.StatusCreated || res["success"] != true {
		t.Fatalf("POST product: %d %v", code, res)
	}
	data := res["data"].(map[string]any)
	id := data["id"].(string)
	if !strings.HasPrefix(id, "PROD_") || data["name"] != "Cát vàng xây dựng" {
		t.Fatalf("dữ liệu tạo sai: %v", data)
	}
	if res["message"] != "Đã thêm mặt hàng thành công" {
		t.Fatalf("message = %v", res["message"])
	}

	// Trùng tên (không phân biệt hoa thường) -> 409
	code, _ = e.do("POST", "/api/products", map[string]any{"name": "cát vàng xây dựng", "unit": "khối", "cost_price": 1, "selling_price": 2})
	if code != http.StatusConflict {
		t.Fatalf("tạo trùng tên phải trả 409, nhận %d", code)
	}

	code, res = e.do("GET", "/api/products", nil)
	if code != 200 || res["total"].(float64) != 1 {
		t.Fatalf("GET products: %d %v", code, res)
	}

	code, res = e.do("PUT", "/api/products/"+id, map[string]any{"selling_price": 360000, "unit": "m3"})
	if code != 200 {
		t.Fatalf("PUT product: %d %v", code, res)
	}
	upd := res["data"].(map[string]any)
	if upd["selling_price"].(float64) != 360000 || upd["unit"] != "m3" || upd["cost_price"].(float64) != 280000 {
		t.Fatalf("cập nhật sai: %v", upd)
	}

	code, _ = e.do("PUT", "/api/products/KHONG_CO", map[string]any{"selling_price": 1})
	if code != http.StatusNotFound {
		t.Fatalf("PUT sản phẩm không tồn tại phải 404, nhận %d", code)
	}

	code, res = e.do("DELETE", "/api/products/"+id, nil)
	if code != 200 || res["message"] != "Đã xóa mặt hàng thành công" {
		t.Fatalf("DELETE product: %d %v", code, res)
	}
	if len(e.products()) != 0 {
		t.Fatal("sản phẩm chưa bị xóa")
	}
}

func TestProductValidation(t *testing.T) {
	e := newTestEnv(t)
	bad := []map[string]any{
		{"name": "", "unit": "cái", "cost_price": 1, "selling_price": 1},
		{"name": "A", "unit": "  ", "cost_price": 1, "selling_price": 1},
		{"name": "A", "unit": "cái", "cost_price": -1, "selling_price": 1},
		{"name": "A", "unit": "cái", "cost_price": 1, "selling_price": -5},
		{"name": "A", "unit": "cái", "cost_price": 1},
	}
	for _, b := range bad {
		if code, res := e.do("POST", "/api/products", b); code != http.StatusBadRequest || res["success"] != false {
			t.Errorf("dữ liệu %v phải bị từ chối (400), nhận %d", b, code)
		}
	}
	if code, _ := e.do("POST", "/api/products", "{not json"); code != http.StatusBadRequest {
		t.Errorf("JSON hỏng phải trả 400")
	}
	if code, _ := e.do("POST", "/api/products", map[string]any{"name": "A", "unit": "cái", "selling_price": "abc"}); code != http.StatusBadRequest {
		t.Errorf("sai kiểu dữ liệu phải trả 400")
	}
}

// ---------------------------------------------------------------------------
// Hóa đơn
// ---------------------------------------------------------------------------

func sampleInvoice() map[string]any {
	return map[string]any{
		"customer_name": "Bác Hùng Thợ Điện",
		"invoice_date":  "2026-11-16",
		"items": []map[string]any{
			{"line_number": 1, "product_name": "Aptomat Panasonic 32A", "unit": "cái", "quantity": 2, "unit_price": 125000, "total_price": 1},
			{"line_number": 2, "product_name": "Dịch vụ lắp tủ điện tổng", "unit": "gói", "quantity": nil, "unit_price": 300000},
		},
		"note":         "Khách hẹn chiều lấy thêm dây",
		"total_amount": 1, // giá trị gian lận từ client — server phải bỏ qua
	}
}

func TestCreateInvoiceMatchesSpec(t *testing.T) {
	e := newTestEnv(t)
	code, res := e.do("POST", "/api/invoices", sampleInvoice())
	if code != http.StatusCreated {
		t.Fatalf("POST invoice: %d %v", code, res)
	}
	if res["invoice_id"] != "HD_BacHungThoDien_20261116_1015" {
		t.Errorf("invoice_id = %v", res["invoice_id"])
	}
	if res["total_amount"].(float64) != 550000 {
		t.Errorf("total_amount = %v (server phải tự tính lại)", res["total_amount"])
	}
	if res["amount_in_words"] != "Năm trăm năm mươi nghìn đồng chẵn" {
		t.Errorf("amount_in_words = %v", res["amount_in_words"])
	}
	if res["message"] != "Đã lưu hóa đơn thành công" {
		t.Errorf("message = %v", res["message"])
	}

	code, res = e.do("GET", "/api/invoices/HD_BacHungThoDien_20261116_1015", nil)
	if code != 200 {
		t.Fatalf("GET invoice: %d", code)
	}
	inv := res["data"].(map[string]any)
	items := inv["items"].([]any)
	first, second := items[0].(map[string]any), items[1].(map[string]any)
	if first["total_price"].(float64) != 250000 || first["is_lump_sum"] != false {
		t.Errorf("dòng 1 sai: %v", first)
	}
	if second["quantity"] != nil || second["is_lump_sum"] != true || second["total_price"].(float64) != 300000 {
		t.Errorf("dòng bán khoán sai: %v", second)
	}
	if inv["created_at"] != "2026-11-16T10:15:30+07:00" || inv["note"] != "Khách hẹn chiều lấy thêm dây" {
		t.Errorf("thông tin hóa đơn sai: %v", inv)
	}
}

func TestLumpSumVariants(t *testing.T) {
	e := newTestEnv(t)
	body := map[string]any{
		"items": []map[string]any{
			{"product_name": "Khoán vật tư phụ", "unit": "", "quantity": "", "unit_price": 350000},
			{"product_name": "Ống nhựa D21", "unit": "cây", "quantity": "1,5", "unit_price": "20000"},
			{"product_name": "Băng keo", "unit": "cuộn", "unit_price": 10000}, // thiếu quantity => khoán
			{"product_name": "Ốc vít", "unit": "hộp", "quantity": 0, "unit_price": 50000},
		},
	}
	code, res := e.do("POST", "/api/invoices", body)
	if code != http.StatusCreated {
		t.Fatalf("%d %v", code, res)
	}
	// 350000 + 30000 + 10000 + 0
	if res["total_amount"].(float64) != 390000 {
		t.Errorf("total = %v", res["total_amount"])
	}
	inv := res["data"].(map[string]any)
	if inv["customer_name"] != "Khách lẻ" || inv["invoice_date"] != "2026-11-16" {
		t.Errorf("mặc định Khách lẻ / ngày hôm nay sai: %v %v", inv["customer_name"], inv["invoice_date"])
	}
	if !strings.HasPrefix(inv["id"].(string), "HD_KhachLe_20261116_1015") {
		t.Errorf("id = %v", inv["id"])
	}
}

func TestInvoiceValidation(t *testing.T) {
	e := newTestEnv(t)
	bad := []map[string]any{
		{"items": []any{}},
		{},
		{"items": []map[string]any{{"product_name": "  ", "unit_price": 1}}},
		{"items": []map[string]any{{"product_name": "A", "unit_price": -1}}},
		{"items": []map[string]any{{"product_name": "A"}}},
		{"items": []map[string]any{{"product_name": "A", "unit_price": "abc"}}},
		{"items": []map[string]any{{"product_name": "A", "unit_price": 1, "quantity": -2}}},
		{"items": []map[string]any{{"product_name": "A", "unit_price": 1}}, "invoice_date": "16/11/2026"},
	}
	for _, b := range bad {
		if code, res := e.do("POST", "/api/invoices", b); code != http.StatusBadRequest {
			t.Errorf("dữ liệu %v phải bị từ chối (400), nhận %d %v", b, code, res)
		}
	}
	var count int
	e.app.Invoices.View(func(v []models.Invoice) { count = len(v) })
	if count != 0 {
		t.Fatal("hóa đơn lỗi không được ghi vào lịch sử")
	}
}

// TC07: mặt hàng mới chưa có trong thư viện phải được tự động thêm.
func TestAutoSyncLibrary(t *testing.T) {
	e := newTestEnv(t)
	e.do("POST", "/api/products", map[string]any{"name": "Aptomat Panasonic 32A", "unit": "cái", "cost_price": 100000, "selling_price": 125000})

	code, res := e.do("POST", "/api/invoices", sampleInvoice())
	if code != http.StatusCreated {
		t.Fatal(code, res)
	}
	synced := res["synced_products"].([]any)
	if len(synced) != 1 || synced[0].(map[string]any)["name"] != "Dịch vụ lắp tủ điện tổng" {
		t.Fatalf("synced_products = %v", synced)
	}
	list := e.products()
	if len(list) != 2 {
		t.Fatalf("thư viện phải có 2 mặt hàng, có %d", len(list))
	}
	added := list[1]
	if added.Unit != "gói" || added.SellingPrice != 300000 || added.CostPrice != 0 || added.ID == list[0].ID {
		t.Errorf("mặt hàng tự đồng bộ sai: %+v", added)
	}

	// Lưu lại lần nữa: không được tạo trùng.
	e.do("POST", "/api/invoices", sampleInvoice())
	if n := len(e.products()); n != 2 {
		t.Fatalf("bị tạo trùng mặt hàng, thư viện có %d", n)
	}
}

func TestInvoiceIDUniqueInSameMinute(t *testing.T) {
	e := newTestEnv(t)
	_, r1 := e.do("POST", "/api/invoices", sampleInvoice())
	_, r2 := e.do("POST", "/api/invoices", sampleInvoice())
	if r1["invoice_id"] == r2["invoice_id"] {
		t.Fatalf("mã hóa đơn bị trùng: %v", r1["invoice_id"])
	}
	if r2["invoice_id"] != "HD_BacHungThoDien_20261116_1015_2" {
		t.Errorf("id thứ 2 = %v", r2["invoice_id"])
	}
}

func TestListInvoicesSearchAndDate(t *testing.T) {
	e := newTestEnv(t)
	base := e.app.Now()
	mk := func(name, date string, offset time.Duration) {
		e.app.Now = func() time.Time { return base.Add(offset) }
		body := map[string]any{"customer_name": name, "invoice_date": date,
			"items": []map[string]any{{"product_name": "Xi măng", "unit": "bao", "quantity": 1, "unit_price": 95000}}}
		if code, res := e.do("POST", "/api/invoices", body); code != 201 {
			t.Fatal(code, res)
		}
	}
	mk("Anh Minh (Công trình số 8)", "2026-11-15", 0)
	mk("Chị Lan", "2026-11-16", time.Hour)
	mk("Anh Minh", "2026-11-16", 2*time.Hour)

	_, res := e.do("GET", "/api/invoices", nil)
	data := res["data"].([]any)
	if len(data) != 3 || data[0].(map[string]any)["customer_name"] != "Anh Minh" {
		t.Fatalf("phải sắp xếp mới nhất lên đầu: %v", data)
	}
	if data[0].(map[string]any)["items_count"].(float64) != 1 {
		t.Errorf("items_count sai")
	}

	_, res = e.do("GET", "/api/invoices?search=minh", nil)
	if res["total"].(float64) != 2 {
		t.Errorf("tìm 'minh' (không dấu) phải ra 2, ra %v", res["total"])
	}
	_, res = e.do("GET", "/api/invoices?search=HD_ChiLan", nil)
	if res["total"].(float64) != 1 {
		t.Errorf("tìm theo mã HĐ phải ra 1, ra %v", res["total"])
	}
	_, res = e.do("GET", "/api/invoices?date=2026-11-16", nil)
	if res["total"].(float64) != 2 {
		t.Errorf("lọc ngày phải ra 2, ra %v", res["total"])
	}
	_, res = e.do("GET", "/api/invoices?date=2026-11-16&search=lan", nil)
	if res["total"].(float64) != 1 {
		t.Errorf("lọc kết hợp phải ra 1, ra %v", res["total"])
	}
	if code, _ := e.do("GET", "/api/invoices?date=abc", nil); code != 400 {
		t.Errorf("ngày sai định dạng phải trả 400")
	}
}

func TestUpdateAndDeleteInvoice(t *testing.T) {
	e := newTestEnv(t)
	_, res := e.do("POST", "/api/invoices", sampleInvoice())
	id := res["invoice_id"].(string)

	body := sampleInvoice()
	body["items"] = append(body["items"].([]map[string]any),
		map[string]any{"product_name": "Dây điện Trần Phú 2x2.5", "unit": "mét", "quantity": 10, "unit_price": 12000})
	code, res := e.do("PUT", "/api/invoices/"+id, body)
	if code != 200 || res["invoice_id"] != id || res["total_amount"].(float64) != 670000 {
		t.Fatalf("PUT invoice: %d %v", code, res)
	}
	inv := res["data"].(map[string]any)
	if inv["updated_at"] == nil || inv["created_at"] != "2026-11-16T10:15:30+07:00" {
		t.Errorf("cập nhật phải giữ created_at và có updated_at: %v", inv)
	}

	if code, _ := e.do("PUT", "/api/invoices/HD_KHONG_CO", body); code != 404 {
		t.Errorf("PUT hóa đơn không tồn tại phải 404")
	}
	if code, _ := e.do("DELETE", "/api/invoices/"+id, nil); code != 200 {
		t.Errorf("DELETE thất bại")
	}
	if code, _ := e.do("GET", "/api/invoices/"+id, nil); code != 404 {
		t.Errorf("hóa đơn đã xóa vẫn còn")
	}
	if code, _ := e.do("DELETE", "/api/invoices/"+id, nil); code != 404 {
		t.Errorf("xóa lần 2 phải 404")
	}
}

// TC14: nhiều tab / máy trạm cùng lưu hóa đơn đồng thời -> không mất dữ liệu.
func TestConcurrentInvoiceSaves(t *testing.T) {
	e := newTestEnv(t)
	const n = 60
	var wg sync.WaitGroup
	errs := make(chan string, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body := map[string]any{
				"customer_name": "Khách " + fmt.Sprint(i%3),
				"items": []map[string]any{
					{"product_name": fmt.Sprintf("Vật tư mới %d", i), "unit": "cái", "quantity": 1, "unit_price": 1000},
					{"product_name": "Vật tư chung", "unit": "cái", "quantity": 2, "unit_price": 500},
				},
			}
			raw, _ := json.Marshal(body)
			req := httptest.NewRequest("POST", "/api/invoices", bytes.NewReader(raw))
			rec := httptest.NewRecorder()
			e.handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusCreated {
				errs <- rec.Body.String()
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for msg := range errs {
		t.Error(msg)
	}

	// Đọc lại trực tiếp từ file trên đĩa.
	raw, err := os.ReadFile(filepath.Join(e.dir, HistoryFile))
	if err != nil {
		t.Fatal(err)
	}
	var saved []models.Invoice
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatalf("history_data.json bị hỏng: %v", err)
	}
	ids := map[string]bool{}
	for _, inv := range saved {
		ids[inv.ID] = true
	}
	if len(saved) != n || len(ids) != n {
		t.Fatalf("lưu %d hóa đơn nhưng file có %d (%d mã khác nhau)", n, len(saved), len(ids))
	}

	rawP, _ := os.ReadFile(filepath.Join(e.dir, ProductsFile))
	var products []models.Product
	if err := json.Unmarshal(rawP, &products); err != nil {
		t.Fatalf("products_data.json bị hỏng: %v", err)
	}
	if len(products) != n+1 { // n mặt hàng riêng + 1 mặt hàng chung
		t.Fatalf("thư viện có %d mặt hàng, mong đợi %d", len(products), n+1)
	}
}

func TestStatsAndSettings(t *testing.T) {
	e := newTestEnv(t)
	e.do("POST", "/api/products", map[string]any{"name": "Xi măng", "unit": "bao", "cost_price": 75000, "selling_price": 95000})
	e.do("POST", "/api/invoices", sampleInvoice())

	code, res := e.do("GET", "/api/stats", nil)
	if code != 200 {
		t.Fatal(code)
	}
	d := res["data"].(map[string]any)
	if d["invoice_count"].(float64) != 1 || d["total_revenue"].(float64) != 550000 || d["product_count"].(float64) != 3 {
		t.Errorf("stats sai: %v", d)
	}
	days := d["last_7_days"].([]any)
	if len(days) != 7 || days[6].(map[string]any)["revenue"].(float64) != 550000 {
		t.Errorf("doanh thu 7 ngày sai: %v", days)
	}

	code, res = e.do("PUT", "/api/settings", map[string]any{"store_name": " Cửa hàng  Minh Phát ", "address": "Hà Nội", "phone": "0900", "invoice_title": ""})
	if code != 200 {
		t.Fatal(code, res)
	}
	_, res = e.do("GET", "/api/settings", nil)
	s := res["data"].(map[string]any)
	if s["store_name"] != "Cửa hàng Minh Phát" || s["invoice_title"] != "HÓA ĐƠN BÁN LẺ" {
		t.Errorf("settings sai: %v", s)
	}
}

func TestRoutingAndStatic(t *testing.T) {
	e := newTestEnv(t)
	if code, res := e.do("GET", "/api/khong-co", nil); code != 404 || res["success"] != false {
		t.Errorf("API không tồn tại phải trả JSON 404")
	}
	if code, res := e.do("GET", "/api/health", nil); code != 200 || res["success"] != true {
		t.Errorf("health check lỗi")
	}
	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "<title>test</title>") {
		t.Errorf("không phục vụ được index.html: %d", rec.Code)
	}
}
