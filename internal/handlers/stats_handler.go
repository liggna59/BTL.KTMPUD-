package handlers

import (
	"math"
	"net/http"
	"sort"
	"time"

	"btktpmud/internal/models"
)

type dayRevenue struct {
	Date         string  `json:"date"`
	Revenue      float64 `json:"revenue"`
	InvoiceCount int     `json:"invoice_count"`
}

type topProduct struct {
	Name     string  `json:"name"`
	Unit     string  `json:"unit"`
	Quantity float64 `json:"quantity"`
	Revenue  float64 `json:"revenue"`
	Lines    int     `json:"lines"`
}

// GetStats xử lý GET /api/stats — số liệu cho tab Thống Kê Nhanh.
func (a *App) GetStats(w http.ResponseWriter, r *http.Request) {
	now := a.Now()
	today := now.Format("2006-01-02")

	// Doanh thu 7 ngày gần nhất (tính theo ngày lập hóa đơn).
	days := make([]dayRevenue, 7)
	dayIndex := make(map[string]int, 7)
	for i := 0; i < 7; i++ {
		d := now.AddDate(0, 0, i-6).Format("2006-01-02")
		days[i] = dayRevenue{Date: d}
		dayIndex[d] = i
	}

	var (
		invoiceCount, todayCount int
		totalRevenue, todayRev   float64
		lumpSumLines             int
	)
	top := map[string]*topProduct{}

	a.Invoices.View(func(list []models.Invoice) {
		invoiceCount = len(list)
		for _, inv := range list {
			totalRevenue += inv.TotalAmount
			if inv.InvoiceDate == today {
				todayCount++
				todayRev += inv.TotalAmount
			}
			if i, ok := dayIndex[inv.InvoiceDate]; ok {
				days[i].Revenue += inv.TotalAmount
				days[i].InvoiceCount++
			}
			for _, it := range inv.Items {
				if it.IsLumpSum {
					lumpSumLines++
				}
				key := models.NameKey(it.ProductName)
				tp := top[key]
				if tp == nil {
					tp = &topProduct{Name: it.ProductName, Unit: it.Unit}
					top[key] = tp
				}
				tp.Revenue += it.TotalPrice
				tp.Lines++
				if it.Quantity != nil {
					tp.Quantity += *it.Quantity
				}
			}
		}
	})

	productCount := 0
	a.Products.View(func(list []models.Product) { productCount = len(list) })

	tops := make([]topProduct, 0, len(top))
	for _, tp := range top {
		tp.Quantity = math.Round(tp.Quantity*1000) / 1000
		tops = append(tops, *tp)
	}
	sort.Slice(tops, func(i, j int) bool {
		if tops[i].Revenue != tops[j].Revenue {
			return tops[i].Revenue > tops[j].Revenue
		}
		return tops[i].Name < tops[j].Name
	})
	if len(tops) > 5 {
		tops = tops[:5]
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"invoice_count":  invoiceCount,
			"total_revenue":  totalRevenue,
			"product_count":  productCount,
			"today":          map[string]any{"date": today, "invoice_count": todayCount, "revenue": todayRev},
			"last_7_days":    days,
			"top_products":   tops,
			"lump_sum_lines": lumpSumLines,
			"generated_at":   now.Format(time.RFC3339),
		},
	})
}

// GetSettings xử lý GET /api/settings — thông tin cửa hàng in trên hóa đơn.
func (a *App) GetSettings(w http.ResponseWriter, r *http.Request) {
	var s models.Settings
	a.Settings.View(func(v models.Settings) { s = v })
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": s})
}

// UpdateSettings xử lý PUT /api/settings.
func (a *App) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var s models.Settings
	if !decodeJSON(w, r, &s) {
		return
	}
	if err := s.Normalize(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.Settings.Update(func(models.Settings) (models.Settings, error) { return s, nil }); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Đã lưu thông tin cửa hàng", "data": s})
}
