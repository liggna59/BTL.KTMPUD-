package handlers

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"btktpmud/internal/models"
)

// ListProducts xử lý GET /api/products — trả về toàn bộ thư viện vật tư.
func (a *App) ListProducts(w http.ResponseWriter, r *http.Request) {
	var data []models.Product
	a.Products.View(func(list []models.Product) {
		data = slices.Clone(list)
	})
	if data == nil {
		data = []models.Product{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": data, "total": len(data)})
}

// GetProduct xử lý GET /api/products/{id}.
func (a *App) GetProduct(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var found *models.Product
	a.Products.View(func(list []models.Product) {
		if i := indexProduct(list, id); i >= 0 {
			p := list[i]
			found = &p
		}
	})
	if found == nil {
		writeError(w, http.StatusNotFound, "Không tìm thấy mặt hàng "+id)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": found})
}

// CreateProduct xử lý POST /api/products — thêm mặt hàng mới vào thư viện.
func (a *App) CreateProduct(w http.ResponseWriter, r *http.Request) {
	var in models.ProductInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.CostPrice == nil {
		zero := 0.0
		in.CostPrice = &zero
	}
	if in.SellingPrice == nil {
		writeError(w, http.StatusBadRequest, "Giá bán phải là số lớn hơn hoặc bằng 0")
		return
	}
	var p models.Product
	in.ApplyTo(&p)
	if err := p.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	err := a.Products.Update(func(list []models.Product) ([]models.Product, error) {
		if dup := findByName(list, p.Name); dup != nil {
			return nil, conflict("Mặt hàng \"%s\" đã có trong thư viện (mã %s)", dup.Name, dup.ID)
		}
		now := a.Now()
		p.ID = newProductID(list, now)
		p.CreatedAt = now.Format(time.RFC3339)
		return append(slices.Clone(list), p), nil
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"success": true,
		"message": "Đã thêm mặt hàng thành công",
		"data":    p,
	})
}

// UpdateProduct xử lý PUT /api/products/{id} — cập nhật tên, ĐVT, giá vốn, giá bán.
func (a *App) UpdateProduct(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in models.ProductInput
	if !decodeJSON(w, r, &in) {
		return
	}
	var updated models.Product
	err := a.Products.Update(func(list []models.Product) ([]models.Product, error) {
		i := indexProduct(list, id)
		if i < 0 {
			return nil, notFound("Không tìm thấy mặt hàng %s", id)
		}
		p := list[i]
		in.ApplyTo(&p)
		if err := p.Validate(); err != nil {
			return nil, &models.ValidationError{Msg: err.Error()}
		}
		if dup := findByName(list, p.Name); dup != nil && dup.ID != p.ID {
			return nil, conflict("Tên \"%s\" đã được dùng cho mặt hàng %s", dup.Name, dup.ID)
		}
		next := slices.Clone(list)
		next[i] = p
		updated = p
		return next, nil
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Đã cập nhật mặt hàng thành công",
		"data":    updated,
	})
}

// DeleteProduct xử lý DELETE /api/products/{id}.
func (a *App) DeleteProduct(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	err := a.Products.Update(func(list []models.Product) ([]models.Product, error) {
		i := indexProduct(list, id)
		if i < 0 {
			return nil, notFound("Không tìm thấy mặt hàng %s", id)
		}
		return slices.Delete(slices.Clone(list), i, i+1), nil
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Đã xóa mặt hàng thành công"})
}

// ---------------------------------------------------------------------------

func indexProduct(list []models.Product, id string) int {
	for i := range list {
		if list[i].ID == id {
			return i
		}
	}
	return -1
}

func findByName(list []models.Product, name string) *models.Product {
	key := models.NameKey(name)
	for i := range list {
		if models.NameKey(list[i].Name) == key {
			return &list[i]
		}
	}
	return nil
}

// newProductID sinh mã dạng "PROD_<unix>", tăng dần nếu bị trùng.
func newProductID(list []models.Product, now time.Time) string {
	used := make(map[string]bool, len(list))
	for _, p := range list {
		used[strings.ToUpper(p.ID)] = true
	}
	n := now.Unix()
	for {
		id := fmt.Sprintf("PROD_%d", n)
		if !used[id] {
			return id
		}
		n++
	}
}
