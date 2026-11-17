// Package btktpmud nhúng toàn bộ giao diện web (thư mục web/) vào file thực thi,
// giúp ứng dụng chạy được chỉ với 1 file .exe duy nhất.
package btktpmud

import (
	"embed"
	"io/fs"
)

//go:embed web
var embeddedWeb embed.FS

// WebFS trả về hệ thống file chứa giao diện web (gốc là thư mục web/).
func WebFS() fs.FS {
	sub, err := fs.Sub(embeddedWeb, "web")
	if err != nil {
		panic(err)
	}
	return sub
}
