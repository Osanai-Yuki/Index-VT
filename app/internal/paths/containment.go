package paths

import (
	"fmt"
	"path/filepath"
	"strings"
)

// Contains 返回 target 的绝对净化路径；仅做词法包含检查：target 必须位于 base 内
// 且不得等于 base 本身，否则报错。不检查目标是否真实存在（调用方在文件尚未落盘的
// 流程里也依赖这个纯词法保证），也不跟随符号链接：models/ 位于用户自有目录，
// 软链逃逸面不在此威胁模型内。
// 用途：AssignUnknown / Delete 等「路径来自前端」的绑定必须过此关（spec B16/B17）。
func Contains(base, target string) (string, error) {
	absBase, err := filepath.Abs(filepath.Clean(base))
	if err != nil {
		return "", err
	}
	absT, err := filepath.Abs(filepath.Clean(target))
	if err != nil {
		return "", err
	}
	if absT == absBase {
		return "", fmt.Errorf("路径必须是文件而非目录: %s", target)
	}
	prefix := absBase + string(filepath.Separator)
	if !strings.HasPrefix(strings.ToLower(absT), strings.ToLower(prefix)) {
		return "", fmt.Errorf("路径越界：不在 %s 内", absBase)
	}
	return absT, nil
}

// ValidateGGUFName 校验文件名：不含路径分隔符、不含 ..、必须 .gguf 后缀。
// Windows 大小写不敏感，后缀比较用 ToLower。
func ValidateGGUFName(name string) error {
	if name == "" {
		return fmt.Errorf("文件名为空")
	}
	if filepath.Base(name) != name {
		return fmt.Errorf("文件名不得包含路径: %s", name)
	}
	if strings.Contains(name, "..") {
		return fmt.Errorf("文件名不得包含 ..: %s", name)
	}
	if !strings.HasSuffix(strings.ToLower(name), ".gguf") || len(name) <= len(".gguf") {
		return fmt.Errorf("仅接受 .gguf 文件: %s", name)
	}
	return nil
}
