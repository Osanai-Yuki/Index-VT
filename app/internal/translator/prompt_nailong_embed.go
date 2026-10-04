package translator

import (
	_ "embed"
	"fmt"
)

//go:embed testdata/official/nailong/nailong_zh-en.txt
var nailongZhEn string

//go:embed testdata/official/nailong/nailong_en-zh.txt
var nailongEnZh string

//go:embed testdata/official/nailong/nailong_zh-ja.txt
var nailongZhJa string

//go:embed testdata/official/nailong/nailong_ja-zh.txt
var nailongJaZh string

func nailongTemplate(d NailongDirection) (string, error) {
	switch d {
	case DirZhEn:
		return nailongZhEn, nil
	case DirEnZh:
		return nailongEnZh, nil
	case DirZhJa:
		return nailongZhJa, nil
	case DirJaZh:
		return nailongJaZh, nil
	}
	return "", errUnknownDirection(d)
}

func errUnknownDirection(d NailongDirection) error {
	return fmt.Errorf("未知方向 %q（可选 zh-en / en-zh / zh-ja / ja-zh）", string(d))
}

func errEmptyText() error          { return fmt.Errorf("原文为空") }
func errBadTemplate(d NailongDirection) error {
	return fmt.Errorf("模板 %s 占位符缺失或重复", string(d))
}
