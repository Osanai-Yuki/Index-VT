package modelmanager

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// 构造合成 GGUF（v3 小端）：magic + version + tensor_count + kv_count + kvs。
func buildTestGGUF(t *testing.T) []byte {
	t.Helper()
	var b []byte
	putU32 := func(v uint32) { x := make([]byte, 4); binary.LittleEndian.PutUint32(x, v); b = append(b, x...) }
	putU64 := func(v uint64) { x := make([]byte, 8); binary.LittleEndian.PutUint64(x, v); b = append(b, x...) }
	putStr := func(s string) {
		putU64(uint64(len(s)))
		b = append(b, s...)
	}
	b = append(b, 'G', 'G', 'U', 'F')
	putU32(3)    // version
	putU64(101)  // tensor_count
	putU64(3)    // kv_count
	putStr("general.architecture")
	putU32(uint32(ggufTypeString))
	putStr("qwen35")
	putStr("general.name")
	putU32(uint32(ggufTypeString))
	putStr("Index-Translate-2B")
	putStr("general.file_type")
	putU32(uint32(ggufTypeUint32))
	putU32(15) // Q4_K_M
	return b
}

func TestReadGGUFMetaSynthetic(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "Index-Translate-2B.Q4_K_M.gguf")
	if err := os.WriteFile(p, buildTestGGUF(t), 0o644); err != nil {
		t.Fatal(err)
	}
	meta, err := ReadGGUFMeta(p)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Name != "Index-Translate-2B" {
		t.Fatalf("name=%q", meta.Name)
	}
	if meta.Architecture != "qwen35" {
		t.Fatalf("arch=%q", meta.Architecture)
	}
	if meta.FileType != 15 || meta.FileTypeQuant() != "Q4_K_M" {
		t.Fatalf("file_type=%d quant=%q", meta.FileType, meta.FileTypeQuant())
	}
}

func TestReadGGUFMetaBadMagic(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "bad.gguf")
	if err := os.WriteFile(p, []byte("NOPE\x00\x00\x00\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadGGUFMeta(p); err == nil {
		t.Fatal("坏 magic 应报错（invalid GGUF magic 场景，02 文档 §4 现象 A）")
	}
}

// 真实官方模型（本机 models/ 已下载 Q4_K_M 时执行；无则跳过）。
func TestReadGGUFMetaRealModel(t *testing.T) {
	home, _ := os.UserHomeDir()
	_ = home
	candidates := []string{
		filepath.Join("..", "..", "..", "models", "Index-Translate-2B.Q4_K_M.gguf"),
	}
	var p string
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && st.Size() > 1<<20 {
			p = c
			break
		}
	}
	if p == "" {
		t.Skip("本地无已下载模型，跳过")
	}
	meta, err := ReadGGUFMeta(p)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Architecture == "" {
		t.Fatal("真实模型 architecture 为空")
	}
	t.Logf("real model: name=%q arch=%q file_type=%d(%s) size_label=%q",
		meta.Name, meta.Architecture, meta.FileType, meta.FileTypeQuant(), meta.SizeLabel)
}

// 注册表：三模型/档位/采样参数红线（01 文档 §3.1/§4.5）。
func TestRegistry(t *testing.T) {
	if len(Registry) != 3 {
		t.Fatalf("registry=%d want 3", len(Registry))
	}
	ts, ok := SpecByID(ModelTranslate)
	if !ok || ts.Temperature != 0 || ts.MaxTokens != 1024 {
		t.Fatalf("Translate 参数不符: %+v", ts)
	}
	if ts.Repo != "IndexTeam/Index-Translate-2B-GGUF" {
		t.Fatalf("Translate repo=%q", ts.Repo)
	}
	nl, _ := SpecByID(ModelNailong)
	if nl.Temperature != 0 || nl.TopP != 1.0 || nl.TopK != -1 {
		t.Fatalf("Nailong greedy 配置不符: %+v", nl)
	}
	if len(nl.StopTokenIDs) != 2 || nl.StopTokenIDs[0] != 248044 || nl.StopTokenIDs[1] != 248046 {
		t.Fatalf("Nailong stop_token_ids 红线不符: %v", nl.StopTokenIDs)
	}
	hm, _ := SpecByID(ModelHomura)
	if hm.Temperature != 0.3 {
		t.Fatalf("Homura temperature=%v", hm.Temperature)
	}
	for _, spec := range Registry {
		if spec.Files[QuantQ4KM] == "" || spec.Files[QuantQ8] == "" {
			t.Fatalf("%s 缺档位文件名", spec.ID)
		}
		if spec.DefaultQuant != QuantQ4KM {
			t.Fatalf("%s 默认档位应为 Q4_K_M", spec.ID)
		}
	}
}

func TestFilenamePattern(t *testing.T) {
	cases := map[string]bool{
		"Index-Translate-2B.Q4_K_M.gguf": true,
		"Index-Nailong-2B.Q8_0.gguf":     true,
		"Index-Homura-2B.Q4_K_M.gguf":    true,
		"Index-Translate-2B.Q4_K_S.gguf": false, // 非 M2 支持档位
		"random.gguf":                    false,
		"index-translate-2b.q4_k_m.gguf": true, // 大小写不敏感
	}
	for name, want := range cases {
		if got := filenameRe.MatchString(name); got != want {
			t.Fatalf("pattern(%q)=%v want %v", name, got, want)
		}
	}
}
