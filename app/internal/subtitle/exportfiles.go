package subtitle

import (
	"fmt"
	"indexvt/internal/atomicfile"
	"path/filepath"
	"strings"
)

// ExportFiles uses one snapshot for paired exports and prepares both before replacing either.
func (e *Engine) ExportFiles(id string, opt ExportOptions) error {
	e.mu.Lock()
	doc := e.docs[id]
	if doc == nil {
		e.mu.Unlock()
		return fmt.Errorf("文档不存在")
	}
	snap := e.snapshotLocked(doc)
	e.mu.Unlock()
	if len(snap.Cues) == 0 {
		return fmt.Errorf("没有可导出的字幕")
	}
	data, err := e.serialize(snap, opt)
	if err != nil {
		return err
	}
	if opt.Encoding == "gbk" {
		data, err = encodeGBK(data)
		if err != nil {
			return err
		}
	}
	files := []atomicfile.File{{Path: opt.OutPath, Data: data}}
	if opt.Bilingual == BilingualKeepOriginal {
		original, err := e.serializeWithText(snap, opt.Format, true)
		if err != nil {
			return err
		}
		if opt.Encoding == "gbk" {
			original, err = encodeGBK(original)
			if err != nil {
				return err
			}
		}
		path := strings.TrimSuffix(opt.OutPath, filepath.Ext(opt.OutPath)) + ".orig." + string(opt.Format)
		files = append(files, atomicfile.File{Path: path, Data: original})
	}
	for _, file := range files {
		if err := atomicfile.ProtectSource(snap.Path, file.Path); err != nil {
			return err
		}
	}
	return atomicfile.WriteFiles(files)
}
