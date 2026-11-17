// Entrypoint của Hệ thống Quản lý Bán hàng & Hóa đơn Cửa hàng Vật tư.
// Khởi tạo HTTP Server, đăng ký router và tự mở trình duyệt tại http://localhost:8080.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"btktpmud"
	"btktpmud/internal/handlers"
	"btktpmud/internal/utils"
)

// Version được gán khi build: go build -ldflags "-X main.Version=1.0.0"
var Version = "dev"

func main() {
	setupConsole()

	defaultPort := 8080
	if p, err := strconv.Atoi(os.Getenv("PORT")); err == nil && p > 0 {
		defaultPort = p
	}
	port := flag.Int("port", defaultPort, "Cổng HTTP (mặc định 8080, có thể đặt qua biến môi trường PORT)")
	host := flag.String("host", "0.0.0.0", "Địa chỉ lắng nghe (0.0.0.0 = cho phép máy khác trong mạng LAN truy cập)")
	dataDir := flag.String("data", "data", "Thư mục chứa file dữ liệu JSON")
	webDir := flag.String("web", "", "Phục vụ giao diện từ thư mục này thay vì bản nhúng trong file exe (dùng khi phát triển)")
	noBrowser := flag.Bool("no-browser", false, "Không tự động mở trình duyệt khi khởi động")
	flag.Parse()

	log.SetFlags(log.Ldate | log.Ltime)
	fmt.Println("==============================================================")
	fmt.Println("  HỆ THỐNG QUẢN LÝ BÁN HÀNG & HÓA ĐƠN CỬA HÀNG VẬT TƯ  v" + Version)
	fmt.Println("==============================================================")

	absData, _ := filepath.Abs(*dataDir)
	app, err := handlers.NewApp(absData)
	if err != nil {
		fatal("Không mở được dữ liệu trong %s: %v\n  -> Hãy sửa file JSON bị lỗi hoặc khôi phục từ thư mục %s",
			absData, err, filepath.Join(absData, "backups"))
	}
	log.Printf("Thư mục dữ liệu: %s", absData)

	if dir, err := utils.BackupFiles(filepath.Join(absData, "backups"), 14,
		app.Products.Path(), app.Invoices.Path(), app.Settings.Path()); err != nil {
		log.Printf("[CẢNH BÁO] Không sao lưu được dữ liệu: %v", err)
	} else if dir != "" {
		log.Printf("Đã sao lưu dữ liệu đầu ngày vào: %s", dir)
	}

	var webFS fs.FS = btktpmud.WebFS()
	if *webDir != "" {
		webFS = os.DirFS(*webDir)
		log.Printf("Chế độ phát triển: phục vụ giao diện từ %s", *webDir)
	}

	addr := net.JoinHostPort(*host, strconv.Itoa(*port))
	localURL := fmt.Sprintf("http://localhost:%d", *port)

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		// Cổng đã bị chiếm: nhiều khả năng phần mềm đang chạy sẵn -> chỉ mở trình duyệt.
		if isServerRunning(localURL) {
			fmt.Printf("\nPhần mềm đã đang chạy tại %s — mở trình duyệt...\n", localURL)
			if !*noBrowser {
				openBrowser(localURL)
			}
			time.Sleep(2 * time.Second)
			return
		}
		fatal("Không mở được cổng %d: %v\n  -> Hãy đóng phần mềm đang dùng cổng này hoặc chạy với tham số -port 8081", *port, err)
	}

	srv := &http.Server{
		Handler:           app.Routes(webFS),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal("Lỗi máy chủ: %v", err)
		}
	}()

	fmt.Printf("\n  ► Mở trên máy này:       %s\n", localURL)
	if *host == "0.0.0.0" || *host == "" {
		for _, ip := range lanIPs() {
			fmt.Printf("  ► Máy khác trong mạng LAN: http://%s:%d\n", ip, *port)
		}
	}
	fmt.Println("\n  Giữ cửa sổ này mở trong khi bán hàng. Nhấn Ctrl+C để tắt phần mềm.")
	fmt.Println("--------------------------------------------------------------")

	if !*noBrowser {
		go func() {
			time.Sleep(400 * time.Millisecond)
			openBrowser(localURL)
		}()
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	fmt.Println("\nĐang tắt máy chủ...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	fmt.Println("Đã tắt. Dữ liệu đã được lưu an toàn.")
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "\n[LỖI] "+format+"\n", args...)
	if runtime.GOOS == "windows" {
		// Giữ cửa sổ console để người dùng kịp đọc lỗi khi chạy bằng double-click.
		fmt.Fprintln(os.Stderr, "\nNhấn Enter để đóng...")
		var b [1]byte
		_, _ = os.Stdin.Read(b[:])
	}
	os.Exit(1)
}

// isServerRunning kiểm tra phần mềm này đã chạy sẵn trên cổng chưa.
func isServerRunning(baseURL string) bool {
	client := http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := client.Get(baseURL + "/api/health")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// openBrowser mở URL bằng trình duyệt mặc định của hệ điều hành.
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("Không tự mở được trình duyệt, hãy mở thủ công: %s", url)
	}
}

// lanIPs liệt kê địa chỉ IPv4 trong mạng nội bộ để các máy trạm khác truy cập.
func lanIPs() []string {
	var ips []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok {
				if ip4 := ipnet.IP.To4(); ip4 != nil && ip4.IsPrivate() {
					ips = append(ips, ip4.String())
				}
			}
		}
	}
	return ips
}
