// Package atomicfile stages complete exports beside their destination before replacing files.
package atomicfile

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type File struct {
	Path string
	Data []byte
}

func ProtectSource(source, target string) error {
	a, _ := filepath.Abs(source)
	b, _ := filepath.Abs(target)
	same := strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
	if x, e := os.Stat(source); e == nil {
		if y, e := os.Stat(target); e == nil && os.SameFile(x, y) {
			same = true
		}
	}
	if same {
		return fmt.Errorf("不能覆盖导入的原文件，请选择其他文件名")
	}
	return nil
}

func stage(path string, data []byte) (string, error) {
	f, err := os.CreateTemp(filepath.Dir(path), ".indexvt-export-*")
	if err != nil {
		return "", err
	}
	name := f.Name()
	ok := false
	defer func() {
		f.Close()
		if !ok {
			os.Remove(name)
		}
	}()
	if _, err = f.Write(data); err != nil {
		return "", err
	}
	if err = f.Sync(); err != nil {
		return "", err
	}
	if err = f.Close(); err != nil {
		return "", err
	}
	ok = true
	return name, nil
}

func Write(path string, data []byte) error { return WriteFiles([]File{{path, data}}) }

func backup(path string) (string, error) {
	source, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer source.Close()
	target, err := os.CreateTemp(filepath.Dir(path), ".indexvt-backup-*")
	if err != nil {
		return "", err
	}
	name := target.Name()
	ok := false
	defer func() {
		target.Close()
		if !ok {
			os.Remove(name)
		}
	}()
	if _, err = io.Copy(target, source); err != nil {
		return "", err
	}
	if err = target.Sync(); err != nil {
		return "", err
	}
	if err = target.Close(); err != nil {
		return "", err
	}
	ok = true
	return name, nil
}

// WriteFiles stages all outputs and backup copies first. A replacement failure rolls
// back already replaced files. A process crash between two replacements is not a filesystem transaction.
func WriteFiles(files []File) error {
	temps := make([]string, len(files))
	backups := make([]string, len(files))
	defer func() {
		for _, p := range append(temps, backups...) {
			if p != "" {
				os.Remove(p)
			}
		}
	}()
	seen := map[string]bool{}
	for i, file := range files {
		abs, err := filepath.Abs(file.Path)
		if err != nil {
			return err
		}
		key := strings.ToLower(abs)
		if seen[key] {
			return fmt.Errorf("重复导出路径")
		}
		seen[key] = true
		if len(file.Data) == 0 {
			return fmt.Errorf("没有可导出的内容")
		}
		if info, err := os.Stat(file.Path); err == nil {
			if !info.Mode().IsRegular() {
				return fmt.Errorf("导出目标必须是普通文件")
			}
			backups[i], err = backup(file.Path)
			if err != nil {
				return err
			}
		} else if !os.IsNotExist(err) {
			return err
		}
		temps[i], err = stage(file.Path, file.Data)
		if err != nil {
			return fmt.Errorf("导出失败，原文件未修改；请检查空间/权限或选择其他目录：%w", err)
		}
	}
	for i, file := range files {
		if err := os.Rename(temps[i], file.Path); err != nil {
			var rollback error
			for j := i - 1; j >= 0; j-- {
				var e error
				if backups[j] != "" {
					e = os.Rename(backups[j], files[j].Path)
				} else {
					e = os.Remove(files[j].Path)
				}
				if e != nil {
					rollback = e
				}
			}
			if rollback != nil {
				// Preserve recovery copies if an external lock also blocks rollback.
				paths := append([]string(nil), backups...)
				for j := range backups {
					backups[j] = ""
				}
				return fmt.Errorf("导出替换失败：%v；恢复受阻：%v；备份位置：%v", err, rollback, paths)
			}
			return fmt.Errorf("导出失败，已有文件已恢复；请关闭占用文件的程序或选择其他目录：%w", err)
		}
	}
	return nil
}
