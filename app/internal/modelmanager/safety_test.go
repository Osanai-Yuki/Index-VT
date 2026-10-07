package modelmanager

import (
	"context"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"indexvt/internal/paths"
	"indexvt/internal/store"
)

// ---------- OrchestratorView 测试替身 ----------
//
// OrchestratorView（manager.go:64）共 7 个方法：
// State / CurrentModel / CurrentModelPath / EndpointPort / ActiveTasks /
// IdleSeconds / KeepAlive。替身必须全部实现，多一个少一个都编译不过。

// deadlockOrch 复现 setState 的回调形态：State() 在持「opMu」期间反向调用
// m.MarkRan()，构造 AB-BA 环路——
//
//	List     : 持 m.mu → 取 opMu（m.orch.State）
//	setState : 持 opMu → OnEvent → MarkRan → 取 m.mu
//
// 修复后 List 必须先把编排态读成快照（锁外），再持 m.mu 做纯计算。
type deadlockOrch struct {
	m    *Manager
	opMu sync.Mutex // 模拟 orchestrator.opMu
}

func (f *deadlockOrch) State() string {
	f.opMu.Lock()
	defer f.opMu.Unlock()
	f.m.MarkRan("translate") // 模拟 orchestrator.setState 持 opMu 期间回调 OnEvent
	return "idle"
}
func (f *deadlockOrch) CurrentModel() string     { return "" }
func (f *deadlockOrch) CurrentModelPath() string { return "" }
func (f *deadlockOrch) EndpointPort() int        { return 0 }
func (f *deadlockOrch) ActiveTasks() int         { return 0 }
func (f *deadlockOrch) IdleSeconds() int         { return 0 }
func (f *deadlockOrch) KeepAlive()               {}

// stubOrchView 无害版本（不制造环路），供其他安全测试复用。
type stubOrchView struct{}

func (stubOrchView) State() string            { return "idle" }
func (stubOrchView) CurrentModel() string     { return "" }
func (stubOrchView) CurrentModelPath() string { return "" }
func (stubOrchView) EndpointPort() int        { return 0 }
func (stubOrchView) ActiveTasks() int         { return 0 }
func (stubOrchView) IdleSeconds() int         { return 0 }
func (stubOrchView) KeepAlive()               {}

func newManagerForTest(t *testing.T, orch OrchestratorView) *Manager {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(st, orch, nil, nil, nil, nil)
}

// TestListAndMarkRanDoNotDeadlock B13：List × MarkRan 的锁序反转。
// CGO_ENABLED=0 下 -race 不可用，故用显式超时护栏判定死锁。
func TestListAndMarkRanDoNotDeadlock(t *testing.T) {
	m := newManagerForTest(t, &deadlockOrch{})
	m.orch.(*deadlockOrch).m = m // 回填，构造 AB-BA 环路

	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); _ = m.List() }()
		go func() { defer wg.Done(); m.MarkRan("translate") }()
	}
	finished := make(chan struct{})
	go func() { wg.Wait(); close(finished) }()

	select {
	case <-finished:
	case <-time.After(10 * time.Second):
		t.Fatal("List × MarkRan 死锁（AB-BA：m.mu ↔ opMu）")
	}
}

// ---------- Task 1.5：模型下载安全边界（B18） ----------

// TestIsAllowedURLRejectsPlainHTTP B18③：仅允许 https —— 模型完整性不能靠明文
// 传输兜底（http 可被中间人替换 GGUF，落盘后由 llama-server 解析执行）。
func TestIsAllowedURLRejectsPlainHTTP(t *testing.T) {
	bad, _ := url.Parse("http://huggingface.co/x/y.gguf")
	if isAllowedURL(bad) {
		t.Fatal("http:// 不应被允许（仅 https）")
	}
	good, _ := url.Parse("https://huggingface.co/x/y.gguf")
	if !isAllowedURL(good) {
		t.Fatal("https://huggingface.co 应被允许")
	}
	lan, _ := url.Parse("https://169.254.169.254/latest/meta-data")
	if isAllowedURL(lan) {
		t.Fatal("链路本地地址不应被允许")
	}
}

// TestIsAllowedURLPrivateAndLoopbackLiterals 策略回归锁：IP 字面量形式的环回 /
// 私网 / 链路本地 / 未指定地址（含 IPv6 与 v4-mapped 写法）一律拒绝；
// 官方白名单主机（HF / hf.co / ModelScope / OSS）与 https scheme 不受影响。
// 注意：多数私网 IP 断言在收紧前也会因后缀白名单而通过；本用例真正的 RED 只有
// http:// 两例 —— 169.254/metadata 等 IP 字面量在修复前就已被后缀白名单拒绝。
func TestIsAllowedURLPrivateAndLoopbackLiterals(t *testing.T) {
	reject := []string{
		"http://huggingface.co/a/b.gguf", // 明文 scheme（B18③）
		"http://modelscope.cn/a/b.gguf",  // 明文 scheme（B18③）
		"https://127.0.0.1/a/b.gguf",
		"https://127.1.2.3/a/b.gguf",
		"https://[::1]/a/b.gguf",
		"https://[::ffff:127.0.0.1]/a/b.gguf", // v4-mapped 环回
		"https://0.0.0.0/a/b.gguf",
		"https://10.0.0.5/a/b.gguf",
		"https://172.16.0.1/a/b.gguf",
		"https://172.31.255.254/a/b.gguf",
		"https://192.168.1.1/a/b.gguf",
		"https://169.254.169.254/a/b.gguf", // 云元数据端点
		"https://[fe80::1]/a/b.gguf",       // 链路本地 IPv6
		"https://[fd00::1]/a/b.gguf",       // 唯一本地地址（IsPrivate）
		"https://localhost/a/b.gguf",
		"ftp://huggingface.co/a/b.gguf", // 其他 scheme
	}
	for _, raw := range reject {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("parse %s: %v", raw, err)
		}
		if isAllowedURL(u) {
			t.Errorf("应拒绝 %s", raw)
		}
	}
	allow := []string{
		"https://huggingface.co/a/b.gguf",
		"https://cdn-lfs.huggingface.co/a/b.gguf",
		"https://hf.co/a/b.gguf",
		"https://modelscope.cn/models/a/b.gguf",
		"https://modelscope.org/a/b.gguf",
		"https://oss.aliyuncs.com/a/b.gguf",
	}
	for _, raw := range allow {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("parse %s: %v", raw, err)
		}
		if !isAllowedURL(u) {
			t.Errorf("应允许 %s", raw)
		}
	}
}

// TestVerifyIntegrityFailClosed 官方校验和不可用 / 缺条目 / 不一致 → 全部拒绝；
// 一致（大小写不敏感）→ 放行（B18①：原实现 offErr != nil 时仅 log.Warn 后照常落盘，
// 即 fail-open）。
func TestVerifyIntegrityFailClosed(t *testing.T) {
	if err := verifyIntegrity("", errors.New("SHA256SUMS 不可达"), "aaaa"); err == nil {
		t.Fatal("官方校验和取不到时应拒绝，不得放行未校验文件")
	}
	if err := verifyIntegrity("", nil, "aaaa"); err == nil {
		t.Fatal("SHA256SUMS 缺该条目时应拒绝")
	}
	if err := verifyIntegrity("bbbb", nil, "aaaa"); err == nil {
		t.Fatal("校验不一致必须拒绝")
	}
	if err := verifyIntegrity("AAAA", nil, "aaaa"); err != nil {
		t.Fatalf("校验一致却失败: %v", err)
	}
}

// TestMaxDownloadBytesCeilingConstant 数值漂移护栏：上限必须锁定为 4GiB
// （覆盖三模型最大档位，且远低于 int64 溢出阈值）。熔断行为本身无法在本环境
// 端到端触发（需要真实可达的 >4GiB 供体；下载目标 URL 由 sourceURLs 固定为
// 官方域名，本地 httptest 服务器会被私网拒绝策略挡掉），故此处只锁常量取值，
// 不冒充行为覆盖。
func TestMaxDownloadBytesCeilingConstant(t *testing.T) {
	if maxDownloadBytes != 4<<30 {
		t.Fatalf("maxDownloadBytes = %d，期望 4GiB(4<<30)", maxDownloadBytes)
	}
}

// TestVerifyIntegrityUnavailableClassified Finding 1 调用契约：verifyIntegrity 的
// 失败必须可分类 —— 「官方校验和暂不可得」（fetch 失败 / SHA256SUMS 缺条目）需满足
// errors.Is(err, ErrChecksumUnavailable)，调用方据此保留已完成的多 GB .part
// （稍后重试校验，无需重新下载）；「确认不一致」不得匹配该标记，调用方据此删除
// 损坏字节（避免留下会被误装的坏文件）。分类颠倒会导致两类事故：误删可续传
// 下载（数据丢失），或保留坏文件。
func TestVerifyIntegrityUnavailableClassified(t *testing.T) {
	errFetch := verifyIntegrity("", errors.New("SHA256SUMS 不可达"), "aaaa")
	if !errors.Is(errFetch, ErrChecksumUnavailable) {
		t.Errorf("fetch 失败应满足 errors.Is(err, ErrChecksumUnavailable)，实际: %v", errFetch)
	}
	errMissing := verifyIntegrity("", nil, "aaaa")
	if !errors.Is(errMissing, ErrChecksumUnavailable) {
		t.Errorf("SHA256SUMS 缺条目应满足 errors.Is(err, ErrChecksumUnavailable)，实际: %v", errMissing)
	}
	errMismatch := verifyIntegrity("bbbb", nil, "aaaa")
	if errMismatch == nil {
		t.Fatal("校验不一致必须报错")
	}
	if errors.Is(errMismatch, ErrChecksumUnavailable) {
		t.Errorf("校验不一致不得匹配 ErrChecksumUnavailable: %v", errMismatch)
	}
}

// ---------- Task 1.6：路径安全（B16 Delete 误删目录 / B17 AssignUnknown 任意文件移动） ----------

// newManagerWithModelsDir：用 INDEXVT_ROOT 把 models/ 隔离到临时目录
func newManagerWithModelsDir(t *testing.T) (*Manager, string) {
	t.Helper()
	root := t.TempDir()
	t.Setenv("INDEXVT_ROOT", root)
	if err := paths.EnsureDirs(); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(root, "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(st, &stubOrchView{}, nil, nil, nil, nil), paths.ModelsDir()
}

func TestDeleteUnknownQuantKeepsModelsDir(t *testing.T) {
	m, modelsDir := newManagerWithModelsDir(t)
	if err := m.Delete(ModelID("translate"), QuantKind("NOPE")); err == nil {
		t.Fatal("未知档位应报错")
	}
	if _, err := os.Stat(modelsDir); err != nil {
		t.Fatalf("models 目录被误删: %v", err)
	}
}

func TestAssignUnknownRejectsPathOutsideModels(t *testing.T) {
	m, _ := newManagerWithModelsDir(t)
	outside := filepath.Join(t.TempDir(), "hosts")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AssignUnknown(outside, ModelID("translate"), QuantKind("Q4_K_M")); err == nil {
		t.Fatal("models/ 外的路径必须被拒绝（否则就是任意文件移动原语）")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("文件被移走了: %v", err)
	}
}

// TestDeleteUnknownQuantOnEmptyModelsDirKeepsIt：上面 brief 版用例走过 EnsureDirs，
// models/ 内已有 data/ 子目录（DataDir()==ModelsDir()/data），os.Remove(目录) 会因
// 「目录非空」顺带报错 —— 那是「侥幸安全」。本用例只建一个空的 models/，直接暴露
// 缺陷本体：档位未命中 → Join 出目录本身 → 空目录被 os.Remove 真删且返回 nil。
func TestDeleteUnknownQuantOnEmptyModelsDirKeepsIt(t *testing.T) {
	root := t.TempDir()
	t.Setenv("INDEXVT_ROOT", root)
	if err := os.MkdirAll(paths.ModelsDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(root, "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	m := New(st, &stubOrchView{}, nil, nil, nil, nil)

	if err := m.Delete(ModelTranslate, QuantKind("NOPE")); err == nil {
		t.Error("未知档位必须报错（修复前：空 models/ 被静默删除且返回 nil）")
	}
	if _, err := os.Stat(paths.ModelsDir()); err != nil {
		t.Fatalf("models 目录被误删: %v", err)
	}
}

// TestAssignUnknownDoesNotMoveGGUFOutsideModels：喂给 AssignUnknown 一个能通过
// ReadGGUFMeta 但位于 models/ 之外的 GGUF —— 修复前它会先解析头、再 os.Rename
// 把文件搬进 models/（任意文件移动原语，源文件被毁）；修复后必须在归拢检查处
// 拒绝，且源文件原地不动。
func TestAssignUnknownDoesNotMoveGGUFOutsideModels(t *testing.T) {
	m, _ := newManagerWithModelsDir(t)
	outside := filepath.Join(t.TempDir(), "evil.gguf")
	if err := os.WriteFile(outside, buildTestGGUF(t), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AssignUnknown(outside, ModelTranslate, QuantQ4KM); err == nil {
		t.Error("models/ 外的 GGUF 必须被拒绝（否则任意文件可被搬进 models/）")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Errorf("源文件被移走: %v", err)
	}
}

// TestAssignUnknownAcceptsGGUFInsideModels 正对照：归拢校验不得误伤合法路径 ——
// models/ 内、以注册表目标文件名命名的 GGUF 仍可指派成功。
func TestAssignUnknownAcceptsGGUFInsideModels(t *testing.T) {
	m, modelsDir := newManagerWithModelsDir(t)
	inside := filepath.Join(modelsDir, "Index-Translate-2B.Q4_K_M.gguf")
	if err := os.WriteFile(inside, buildTestGGUF(t), 0o644); err != nil {
		t.Fatal(err)
	}
	mi, err := m.AssignUnknown(inside, ModelTranslate, QuantQ4KM)
	if err != nil {
		t.Fatalf("models/ 内合法 GGUF 被误拒: %v", err)
	}
	if mi.ID != string(ModelTranslate) {
		t.Fatalf("指派结果 ID = %q", mi.ID)
	}
}

// ---------- ListModels 的下载进度快照 ----------

// TestListExposesDownloadProgress 前端进度条的渲染条件是 `state==='downloading' && download`，
// 而 List() 过去从不填 Download 字段——后端明明在下载，界面却什么都不显示。
// 这条锁住修复，并锁住"返回的是快照拷贝"：序列化发生在 m.mu 之外，
// 若把 handle 里的活指针递出去，并发写会改写一份已经在编码的进度。
func TestListExposesDownloadProgress(t *testing.T) {
	m := newManagerForTest(t, stubOrchView{})
	_, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	h := &downloadHandle{cancel: cancel, quant: QuantQ4KM, spec: Registry[0]}
	m.mu.Lock()
	m.downloads[string(Registry[0].ID)] = h
	m.mu.Unlock()

	m.progressSink(h)(DownloadProgress{
		ModelID: string(Registry[0].ID), Quant: string(QuantQ4KM),
		Phase: "downloading", BytesDone: 512, BytesTotal: 1024, SpeedBPS: 1 << 20,
	})

	list := m.List()
	var found *ModelInfo
	for i := range list {
		if list[i].ID == string(Registry[0].ID) {
			found = &list[i]
			break
		}
	}
	if found == nil {
		t.Fatal("List() 里找不到该模型")
	}
	if found.State != StateDownloading {
		t.Fatalf("State = %q，期望 %q", found.State, StateDownloading)
	}
	if found.Download == nil {
		t.Fatal("Download 为空 —— 进度条渲染不出来，正是原缺陷")
	}
	if found.Download.BytesDone != 512 || found.Download.Phase != "downloading" {
		t.Fatalf("Download 快照不符：%+v", *found.Download)
	}

	m.progressSink(h)(DownloadProgress{Phase: "verifying", BytesDone: 1024, BytesTotal: 1024})
	if found.Download.Phase != "downloading" || found.Download.BytesDone != 512 {
		t.Fatalf("List() 交出的是活指针，快照被后续进度改写：%+v", *found.Download)
	}
}

// TestProgressSinkDoesNotDeadlockWithList 存快照要拿 m.mu，List() 也拿 m.mu 读，
// 且 sink 转发给事件回调必须在解锁之后。并发护栏手法同 B13（本机 -race 不可用）。
func TestProgressSinkDoesNotDeadlockWithList(t *testing.T) {
	m := newManagerForTest(t, stubOrchView{})
	_, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	h := &downloadHandle{cancel: cancel, quant: QuantQ4KM, spec: Registry[0]}
	m.mu.Lock()
	m.downloads[string(Registry[0].ID)] = h
	m.mu.Unlock()
	sink := m.progressSink(h)

	done := make(chan struct{})
	go func() {
		var wg sync.WaitGroup
		for i := 0; i < 300; i++ {
			wg.Add(2)
			go func() { defer wg.Done(); _ = m.List() }()
			go func() { defer wg.Done(); sink(DownloadProgress{Phase: "downloading", BytesDone: int64(i)}) }()
		}
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("List × progressSink 并发疑似死锁")
	}
}
