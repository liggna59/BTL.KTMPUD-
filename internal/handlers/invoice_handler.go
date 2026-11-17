package handlers

import (
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"btktpmud/internal/models"
	"btktpmud/internal/utils"
)

// ListInvoices xử lý GET /api/invoices?search=&date=
// Trả về danh sách tóm tắt hóa đơn, mới nhất lên đầu.
func (a *App) ListInvoices(w http.ResponseWriter, r *http.Request) {
	search := utils.NormalizeSearch(r.URL.Query().Get("search"))
	date := strings.TrimSpace(r.URL.Query().Get("date"))
	if date != "" {
		if _, err := time.Parse("2006-01-02", date); err != nil {
			writeError(w, http.StatusBadRequest, "Tham số date phải có định dạng YYYY-MM-DD")
			return
		}
	}

	data := []models.InvoiceSummary{}
	a.Invoices.View(func(list []models.Invoice) {
		for _, inv := range list {
			if date != "" && inv.InvoiceDate != date {
				continue
			}
			if search != "" &&
				!strings.Contains(utils.NormalizeSearch(inv.CustomerName), search) &&
				!strings.Contains(utils.NormalizeSearch(inv.ID), search) {
				continue
			}
			data = append(data, inv.Summary())
		}
	})
	sort.SliceStable(data, func(i, j int) bool {
		return parseTime(data[i].CreatedAt).After(parseTime(data[j].CreatedAt))
	})
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": data, "total": len(data)})
}

// GetInvoice xử lý GET /api/invoices/{id} — trả về hóa đơn đầy đủ.
func (a *App) GetInvoice(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var found *models.Invoice
	a.Invoices.View(func(list []models.Invoice) {
		if i := indexInvoice(list, id); i >= 0 {
			inv := list[i]
			found = &inv
		}
	})
	if found == nil {
		writeError(w, http.StatusNotFound, "Không tìm thấy hóa đơn "+id)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": found})
}

// CreateInvoice xử lý POST /api/invoices.
//  1. Tính lại thành tiền từng dòng và tổng tiền (chống gian lận phía client).
//  2. Sinh chuỗi đọc số tiền bằng chữ.
//  3. Sinh mã HD_{TenKhach}_{YYYYMMDD_HHmm}.
//  4. Đồng bộ mặt hàng mới vào thư viện (products_data.json).
//  5. Ghi nguyên tử vào history_data.json.
func (a *App) CreateInvoice(w http.ResponseWriter, r *http.Request) {
	var in models.InvoiceInput
	if !decodeJSON(w, r, &in) {
		return
	}
	now := a.Now()
	inv, err := buildInvoice(in, now)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	inv.CreatedAt = now.Format(time.RFC3339)

	added, err := a.syncProducts(inv.Items, now)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	err = a.Invoices.Update(func(list []models.Invoice) ([]models.Invoice, error) {
		inv.ID = newInvoiceID(list, inv.CustomerName, now)
		return append(slices.Clone(list), inv), nil
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"success":         true,
		"message":         "Đã lưu hóa đơn thành công",
		"invoice_id":      inv.ID,
		"total_amount":    inv.TotalAmount,
		"amount_in_words": inv.AmountInWords,
		"synced_products": added,
		"data":            inv,
	})
}

// UpdateInvoice xử lý PUT /api/invoices/{id} — cập nhật hóa đơn đã "Nạp lại (Sửa)".
// Giữ nguyên mã và thời gian tạo, ghi nhận thời gian cập nhật.
func (a *App) UpdateInvoice(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in models.InvoiceInput
	if !decodeJSON(w, r, &in) {
		return
	}
	now := a.Now()
	inv, err := buildInvoice(in, now)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	exists := false
	a.Invoices.View(func(list []models.Invoice) { exists = indexInvoice(list, id) >= 0 })
	if !exists {
		writeError(w, http.StatusNotFound, "Không tìm thấy hóa đơn "+id)
		return
	}

	added, err := a.syncProducts(inv.Items, now)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	err = a.Invoices.Update(func(list []models.Invoice) ([]models.Invoice, error) {
		i := indexInvoice(list, id)
		if i < 0 {
			return nil, notFound("Không tìm thấy hóa đơn %s", id)
		}
		inv.ID = list[i].ID
		inv.CreatedAt = list[i].CreatedAt
		inv.UpdatedAt = now.Format(time.RFC3339)
		next := slices.Clone(list)
		next[i] = inv
		return next, nil
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":         true,
		"message":         "Đã cập nhật hóa đơn thành công",
		"invoice_id":      inv.ID,
		"total_amount":    inv.TotalAmount,
		"amount_in_words": inv.AmountInWords,
		"synced_products": added,
		"data":            inv,
	})
}

// DeleteInvoice xử lý DELETE /api/invoices/{id}.
func (a *App) DeleteInvoice(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	err := a.Invoices.Update(func(list []models.Invoice) ([]models.Invoice, error) {
		i := indexInvoice(list, id)
		if i < 0 {
			return nil, notFound("Không tìm thấy hóa đơn %s", id)
		}
		return slices.Delete(slices.Clone(list), i, i+1), nil
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Đã xóa hóa đơn " + id})
}

// ---------------------------------------------------------------------------

// buildInvoice kiểm tra dữ liệu và tính toán toàn bộ số liệu của hóa đơn phía server.
func buildInvoice(in models.InvoiceInput, now time.Time) (models.Invoice, error) {
	customer, date, note, err := in.NormalizeHeader(now)
	if err != nil {
		return models.Invoice{}, err
	}
	items, total, err := in.BuildItems()
	if err != nil {
		return models.Invoice{}, err
	}
	return models.Invoice{
		CustomerName:  customer,
		InvoiceDate:   date,
		Items:         items,
		TotalAmount:   total,
		AmountInWords: utils.NumberToVietnameseWords(total),
		Note:          note,
	}, nil
}

// syncProducts tự động thêm vào thư viện các mặt hàng chưa có (Auto-sync Library),
// để lần sau thu ngân gõ là có gợi ý. Trả về danh sách mặt hàng vừa được thêm.
func (a *App) syncProducts(items []models.InvoiceItem, now time.Time) ([]models.Product, error) {
	added := []models.Product{}
	err := a.Products.Update(func(list []models.Product) ([]models.Product, error) {
		known := make(map[string]bool, len(list))
		for _, p := range list {
			known[models.NameKey(p.Name)] = true
		}
		next := list
		cloned := false
		for _, it := range items {
			key := models.NameKey(it.ProductName)
			if known[key] {
				continue
			}
			if !cloned {
				next = slices.Clone(list)
				cloned = true
			}
			unit := it.Unit
			if unit == "" {
				unit = "cái"
				if it.IsLumpSum {
					unit = "gói"
				}
			}
			p := models.Product{
				ID:           newProductID(next, now),
				Name:         it.ProductName,
				Unit:         unit,
				CostPrice:    0, // chưa biết giá vốn — thu ngân bổ sung sau trong tab Thư viện
				SellingPrice: it.UnitPrice,
				CreatedAt:    now.Format(time.RFC3339),
			}
			next = append(next, p)
			added = append(added, p)
			known[key] = true
		}
		return next, nil
	})
	return added, err
}

func indexInvoice(list []models.Invoice, id string) int {
	for i := range list {
		if list[i].ID == id {
			return i
		}
	}
	return -1
}

// newInvoiceID sinh mã HD_{SanitizedCustomerName}_{YYYYMMDD_HHmm}; thêm hậu tố _2, _3...
// nếu cùng khách hàng lập nhiều đơn trong cùng một phút.
func newInvoiceID(list []models.Invoice, customer string, now time.Time) string {
	base := "HD_" + utils.SanitizeCustomerName(customer) + "_" + now.Format("20060102_1504")
	used := make(map[string]bool, len(list))
	for _, inv := range list {
		used[inv.ID] = true
	}
	id := base
	for n := 2; used[id]; n++ {
		id = base + "_" + strconv.Itoa(n)
	}
	return id
}

func parseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}
