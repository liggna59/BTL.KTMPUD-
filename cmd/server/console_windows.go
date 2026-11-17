//go:build windows

package main

import "syscall"

// setupConsole chuyển console Windows sang bảng mã UTF-8 để hiển thị đúng tiếng Việt.
func setupConsole() {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	const cpUTF8 = 65001
	if proc := kernel32.NewProc("SetConsoleOutputCP"); proc.Find() == nil {
		_, _, _ = proc.Call(cpUTF8)
	}
	if proc := kernel32.NewProc("SetConsoleCP"); proc.Find() == nil {
		_, _, _ = proc.Call(cpUTF8)
	}
}
