// Package csvsanitizer 中和 CSV 单元格里的公式注入：导出的术语本
// 常被 Excel / WPS 打开，以 = + - @ 开头的内容会被当作公式执行。
package csvsanitizer

import "strings"

// Cell 对以 = + - @ 或制表/回车开头的内容前置单引号，阻断公式解析。
func Cell(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	}
	return s
}

// Quote 先做注入中和，再做 RFC4180 双引号包裹与转义。
func Quote(s string) string {
	return `"` + strings.ReplaceAll(Cell(s), `"`, `""`) + `"`
}
