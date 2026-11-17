// Package handlers chứa lớp nghiệp vụ (Business Logic Layer) và REST API Controller.
package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"

	"btktpmud/internal/models"
	"btktpmud/internal/utils"
)

// App gom các kho dữ liệu dùng chung cho mọi handler.
type App struct {
	Products *utils.JSONStore[[]models.Product]
	Invoices *utils.JSONStore[[]models.Invoice]
	Settings *utils.JSONStore[models.Settings]

	// Now trả về thời điểm hiện tại (cho phép thay thế khi kiểm thử).
	Now func() time.Time
}

// File dữ liệu trong thư mục data/.
const (
	ProductsFile = "products_data.json"
	HistoryFile  = "history_data.json"
	SettingsFile = "settings.json"
)

// NewApp mở các file dữ liệu trong dataDir (tự tạo nếu chưa có).
func NewApp(dataDir string) (*App, error) {
	products, err := utils.OpenJSONStore(filepath.Join(dataDir, ProductsFile), []models.Product{})
	if err != nil {
		return nil, err
	}
	invoices, err := utils.OpenJSONStore(filepath.Join(dataDir, HistoryFile), []models.Invoice{})
	if err != nil {
		return nil, err
	}
	settings, err := utils.OpenJSONStore(filepath.Join(dataDir, SettingsFile), models.DefaultSettings())
	if err != nil {
		return nil, err
	}
	return &App{Products: products, Invoices: invoices, Settings: settings, Now: time.Now}, nil
}

// Routes đăng ký toàn bộ API và phục vụ giao diện web tĩnh từ webFS.
func (a *App) Routes(webFS fs.FS) http.Handler {
	mux := http.NewServeMux()

	// Phân hệ thư viện hàng hóa
	mux.HandleFunc("GET /api/products", a.ListProducts)
	mux.HandleFunc("POST /api/products", a.CreateProduct)
	mux.HandleFunc("GET /api/products/{id}", a.GetProduct)
	mux.HandleFunc("PUT /api/products/{id}", a.UpdateProduct)
	mux.HandleFunc("DELETE /api/products/{id}", a.DeleteProduct)

	// Phân hệ hóa đơn
	mux.HandleFunc("GET /api/invoices", a.ListInvoices)
	mux.HandleFunc("POST /api/invoices", a.CreateInvoice)
	mux.HandleFunc("GET /api/invoices/{id}", a.GetInvoice)
	mux.HandleFunc("PUT /api/invoices/{id}", a.UpdateInvoice)
	mux.HandleFunc("DELETE /api/invoices/{id}", a.DeleteInvoice)

	// Mở rộng: thống kê, cấu hình cửa hàng, kiểm tra kết nối
	mux.HandleFunc("GET /api/stats", a.GetStats)
	mux.HandleFunc("GET /api/settings", a.GetSettings)
	mux.HandleFunc("PUT /api/settings", a.UpdateSettings)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "time": a.Now().Format(time.RFC3339)})
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "Không tìm thấy API: "+r.Method+" "+r.URL.Path)
	})

	// Giao diện web (Single Page Application)
	mux.Handle("/", staticHandler(webFS))

	return recoverMiddleware(logMiddleware(mux))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(body); err != nil {
		log.Printf("Lỗi ghi phản hồi JSON: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"success": false, "message": message})
}

// writeStoreError phân loại lỗi: lỗi dữ liệu đầu vào (400), không tìm thấy (404), xung đột (409), lỗi hệ thống (500).
func writeStoreError(w http.ResponseWriter, err error) {
	var he *httpError
	switch {
	case errors.As(err, &he):
		writeError(w, he.status, he.msg)
	case models.IsValidationError(err):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		log.Printf("[LỖI] %v", err)
		writeError(w, http.StatusInternalServerError, "Lỗi hệ thống khi lưu dữ liệu: "+err.Error())
	}
}

type httpError struct {
	status int
	msg    string
}

func (e *httpError) Error() string { return e.msg }

func notFound(format string, args ...any) error {
	return &httpError{status: http.StatusNotFound, msg: fmt.Sprintf(format, args...)}
}

func conflict(format string, args ...any) error {
	return &httpError{status: http.StatusConflict, msg: fmt.Sprintf(format, args...)}
}

const maxBodyBytes = 2 << 20 // 2 MB

// decodeJSON đọc body JSON với giới hạn kích thước và báo lỗi tiếng Việt dễ hiểu.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		msg := "Dữ liệu gửi lên không đúng định dạng JSON"
		var typeErr *json.UnmarshalTypeError
		var maxErr *http.MaxBytesError
		switch {
		case errors.Is(err, io.EOF):
			msg = "Thiếu dữ liệu gửi lên (body rỗng)"
		case errors.As(err, &typeErr):
			msg = fmt.Sprintf("Trường '%s' sai kiểu dữ liệu", typeErr.Field)
		case errors.As(err, &maxErr):
			msg = "Dữ liệu gửi lên quá lớn"
		}
		writeError(w, http.StatusBadRequest, msg)
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%-6s %-32s %d  %v", r.Method, r.URL.RequestURI(), rec.status, time.Since(start).Round(time.Microsecond))
	})
}

func recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				log.Printf("[PANIC] %v\n%s", v, debug.Stack())
				writeError(w, http.StatusInternalServerError, "Lỗi hệ thống không mong muốn")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// staticHandler phục vụ giao diện web; các file HTML/JS/CSS luôn được kiểm tra lại
// (no-cache) để trình duyệt nhận bản mới ngay sau khi cập nhật phần mềm.
func staticHandler(webFS fs.FS) http.Handler {
	files := http.FileServer(http.FS(webFS))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusMethodNotAllowed, "Phương thức không được hỗ trợ")
			return
		}
		if strings.Contains(r.URL.Path, "/vendor/") {
			w.Header().Set("Cache-Control", "public, max-age=604800")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		if r.URL.Path == "/sw.js" {
			w.Header().Set("Service-Worker-Allowed", "/")
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		files.ServeHTTP(w, r)
	})
}
