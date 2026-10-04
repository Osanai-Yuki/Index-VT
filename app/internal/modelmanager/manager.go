package modelmanager

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"indexvt/internal/paths"
	"indexvt/internal/store"
)

// ModelState 模型七态（01 文档 §5.1 状态机）。
type ModelState string

const (
	StateNotDownloaded ModelState = "not-downloaded"
	StateDownloading   ModelState = "downloading"
	StateReady         ModelState = "ready"
	StateLoading       ModelState = "loading"
	StateRunning       ModelState = "running"
	StateSleeping      ModelState = "sleeping"
	StateCrashed       ModelState = "crashed"
)

// QuantStatus 单个量化档位的本地状态。
type QuantStatus struct {
	Quant     string `json:"quant"`
	Present   bool   `json:"present"`
	Path      string `json:"path,omitempty"`
	SizeBytes int64  `json:"sizeBytes"`
	SHA256    string `json:"sha256,omitempty"`
}

// ModelInfo 模型中心卡片数据。
type ModelInfo struct {
	ID        string        `json:"id"`
	Name      string        `json:"name"`
	Role      string        `json:"role"`
	Languages string        `json:"languages"`
	Repo      string        `json:"repo"`
	State     ModelState    `json:"state"`
	Active    bool          `json:"active"`
	Port      int           `json:"port,omitempty"`
	Quants    []QuantStatus `json:"quants"`
	Source    string        `json:"source,omitempty"` // 上次下载源徽标
	IdleSec   int           `json:"idleSec,omitempty"` // 运行中：空闲秒数（倒计时）
	Download  *DownloadProgress `json:"download,omitempty"`
	IsUnknown bool          `json:"isUnknown,omitempty"`
	Path      string        `json:"path,omitempty"` // 未知文件用
}

// OrchestratorView modelmanager 感知编排状态所需的最小接口（避免循环依赖）。
type OrchestratorView interface {
	State() string                 // orchestrator.OrchestrationState 字符串
	CurrentModel() string
	CurrentModelPath() string
	EndpointPort() int
	ActiveTasks() int
	IdleSeconds() int
	KeepAlive()
}

// Manager ModelManager 实现。
type Manager struct {
	store *store.Store
	orch  OrchestratorView
	log   *slog.Logger

	mu        sync.Mutex
	activeID  string
	downloads map[string]*downloadHandle
	lastRun   map[string]bool   // modelID → 最近是否运行过（休眠态判定）
	curSource map[string]string // modelID → 最近下载源

	sourcePrefFn func() string // 注入：读取用户下载源偏好（auto/hf/modelscope）
	onProgress   func(DownloadProgress)
	onModels     func() // 模型列表变化通知（前端刷新）
}

type downloadHandle struct {
	cancel context.CancelFunc
	quant  QuantKind
	spec   ModelSpec
}

// New 创建 Manager。sourcePrefFn 返回 "auto"|"hf"|"modelscope"。
func New(st *store.Store, orch OrchestratorView, log *slog.Logger,
	sourcePrefFn func() string,
	onProgress func(DownloadProgress), onModels func()) *Manager {
	if log == nil {
		log = slog.Default()
	}
	if sourcePrefFn == nil {
		sourcePrefFn = func() string { return "auto" }
	}
	m := &Manager{
		store: st, orch: orch, log: log,
		downloads:    make(map[string]*downloadHandle),
		lastRun:      make(map[string]bool),
		curSource:    make(map[string]string),
		sourcePrefFn: sourcePrefFn,
	}
	if onProgress != nil {
		m.onProgress = func(p DownloadProgress) { go onProgress(p) }
	} else {
		m.onProgress = func(DownloadProgress) {}
	}
	m.onModels = onModels
	return m
}

func (m *Manager) notify() {
	if m.onModels != nil {
		go m.onModels()
	}
}

// SetActiveID 设置当前激活模型（配置恢复用）。
func (m *Manager) SetActiveID(id string) {
	m.mu.Lock()
	m.activeID = id
	m.mu.Unlock()
}

func (m *Manager) sourcePref() string            { return m.sourcePrefFn() }
func (m *Manager) setCurrentSource(id, s string) {
	m.mu.Lock()
	m.curSource[id] = s
	m.mu.Unlock()
	m.notify()
}
func (m *Manager) currentSource(id string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.curSource[id]
}

// ---------- 本地扫描（01 文档 §5.2 双重识别） ----------

var filenameRe = regexp.MustCompile(`(?i)^Index-(Translate|Nailong|Homura)-2B\.(Q4_K_M|Q8_0)\.gguf$`)

// ScanLocal 扫描 models/ 目录：文件名模式初筛 + GGUF 头确认 + SHA256 登记。
// 返回无法识别的文件列表（未知文件区）。
func (m *Manager) ScanLocal() (known []store.ModelFileRec, unknown []string) {
	dir := paths.ModelsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil
	}
	existing := map[string]bool{}
	recs, _ := m.store.ListModelFiles()
	byPath := map[string]store.ModelFileRec{}
	for _, r := range recs {
		byPath[r.FilePath] = r
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".gguf") {
			continue
		}
		full := filepath.Join(dir, e.Name())
		existing[full] = true
		mm := filenameRe.FindStringSubmatch(e.Name())
		if mm == nil {
			unknown = append(unknown, full)
			continue
		}
		// GGUF 头双重确认
		meta, err := ReadGGUFMeta(full)
		if err != nil {
			m.log.Warn("GGUF 头解析失败", "file", e.Name(), "err", err)
			unknown = append(unknown, full)
			continue
		}
		// 头部量化档位与文件名声明交叉校验（general.name="2b" 较泛，
		// 以文件名为主判据、file_type 为辅证）
		if q := meta.FileTypeQuant(); q != "" && !strings.EqualFold(q, mm[2]) {
			m.log.Warn("量化档位不匹配", "file", e.Name(), "header", q, "filename", mm[2])
			unknown = append(unknown, full)
			continue
		}
		id := mapNameToID(meta.Name, e.Name())
		if id == "" {
			unknown = append(unknown, full)
			continue
		}
		quant := QuantKind(mm[2])
		// SHA256：与登记一致（同路径同体积）则复用，否则重算
		rec := byPath[full]
		st, _ := e.Info()
		if rec.FilePath == full && rec.SHA256 != "" && rec.SizeBytes == st.Size() {
			known = append(known, rec)
			continue
		}
		sha, err := sha256File(full)
		if err != nil {
			m.log.Warn("SHA256 计算失败", "file", e.Name(), "err", err)
			unknown = append(unknown, full)
			continue
		}
		rec = store.ModelFileRec{
			ModelID: string(id), Quant: string(quant), FilePath: full,
			SizeBytes: st.Size(), SHA256: sha, VerifiedAt: time.Now().Unix(),
		}
		_ = m.store.UpsertModelFile(rec)
		known = append(known, rec)
	}
	// 清理已删除文件的登记
	for _, r := range recs {
		if !existing[r.FilePath] {
			_ = m.store.DeleteModelFileByPath(r.FilePath)
		}
	}
	sort.Slice(known, func(i, j int) bool { return known[i].FilePath < known[j].FilePath })
	return known, unknown
}

func mapNameToID(ggufName, filename string) ModelID {
	probe := strings.ToLower(ggufName + " " + filename)
	switch {
	case strings.Contains(probe, "translate"):
		return ModelTranslate
	case strings.Contains(probe, "nailong"):
		return ModelNailong
	case strings.Contains(probe, "homura"):
		return ModelHomura
	}
	return ""
}

// ---------- List ----------

// List 模型中心列表：三模型档案 + 未知文件。
//
// 锁不变量（02 文档 §6.1 锁序 / spec §7，缺陷 B13）：**绝不持 m.mu 调用任何
// m.orch.***。声明顺序是 opMu → m.mu，而 orchestrator.setState 在持 opMu 期间会
// 回调 OnEvent → app.go → Manager.MarkRan 取 m.mu；本函数若反向取（m.mu → opMu）
// 即构成 AB-BA 死锁。故编排态一律先在锁外读成快照，锁内只做纯计算。
func (m *Manager) List() []ModelInfo {
	// 编排态快照（锁外）。端口/空闲秒数仅在 running 时才用到，与旧实现的
	// 惰性取值条件一致，避免无谓地再取一次 opMu。
	orchState := m.orch.State()
	curModel := m.orch.CurrentModel()
	var orchPort, orchIdleSec int
	if orchState == "running" && curModel != "" {
		orchPort = m.orch.EndpointPort()
		orchIdleSec = m.orch.IdleSeconds()
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	recs, _ := m.store.ListModelFiles()
	byModel := map[string][]store.ModelFileRec{}
	for _, r := range recs {
		byModel[r.ModelID] = append(byModel[r.ModelID], r)
	}
	var out []ModelInfo
	for _, spec := range Registry {
		mi := ModelInfo{
			ID: string(spec.ID), Name: spec.Name, Role: spec.Role,
			Languages: spec.Languages, Repo: spec.Repo,
			Active: m.activeID == string(spec.ID),
			Source: m.curSource[string(spec.ID)],
		}
		for _, q := range AllQuants {
			qs := QuantStatus{Quant: string(q)}
			for _, r := range byModel[string(spec.ID)] {
				if r.Quant == string(q) && r.Quant != "" {
					qs.Present = true
					qs.Path = r.FilePath
					qs.SizeBytes = r.SizeBytes
					qs.SHA256 = r.SHA256
					break
				}
			}
			mi.Quants = append(mi.Quants, qs)
		}
		// 兜底：登记缺失但文件存在（Quant 为空的记录）
		for _, r := range byModel[string(spec.ID)] {
			if r.Quant == "" {
				mi.Quants = append(mi.Quants, QuantStatus{
					Quant: guessQuant(r.FilePath), Present: true,
					Path: r.FilePath, SizeBytes: r.SizeBytes, SHA256: r.SHA256,
				})
			}
		}
		if d := m.downloads[string(spec.ID)]; d != nil {
			mi.State = StateDownloading
		} else if mi.Active && curModel != "" {
			switch orchState {
			case "running":
				mi.State = StateRunning
				mi.Port = orchPort
				mi.IdleSec = orchIdleSec
			case "starting":
				mi.State = StateLoading
			case "stopping":
				mi.State = StateLoading
			case "crashed":
				mi.State = StateCrashed
			case "idle":
				if m.lastRun[string(spec.ID)] {
					mi.State = StateSleeping
				} else {
					mi.State = StateReady
				}
			}
		} else {
			mi.State = StateReady
		}
		if !anyPresent(mi.Quants) {
			mi.State = StateNotDownloaded
		}
		out = append(out, mi)
	}
	return out
}

func guessQuant(path string) string {
	if strings.Contains(strings.ToLower(path), "q8_0") {
		return "Q8_0"
	}
	return "Q4_K_M"
}

func anyPresent(qs []QuantStatus) bool {
	for _, q := range qs {
		if q.Present {
			return true
		}
	}
	return false
}

// ListUnknown 未知 GGUF 文件（F-10b"未知文件"区）。
func (m *Manager) ListUnknown() []ModelInfo {
	_, unknown := m.ScanLocal()
	var out []ModelInfo
	for _, u := range unknown {
		out = append(out, ModelInfo{ID: "", Name: filepath.Base(u), IsUnknown: true, Path: u, State: StateNotDownloaded})
	}
	return out
}

// ---------- Download ----------

// Download 启动模型下载（幂等：同模型同档位已在下载则复用现有通道）。
func (m *Manager) Download(id ModelID, quant QuantKind) (<-chan DownloadProgress, error) {
	spec, ok := SpecByID(id)
	if !ok {
		return nil, fmt.Errorf("未知模型: %s", id)
	}
	m.mu.Lock()
	if h, exists := m.downloads[string(id)]; exists && h.quant == quant {
		m.mu.Unlock()
		return nil, fmt.Errorf("该模型正在下载中")
	}
	// 若同模型其他档位在下载 → 拒绝（简化并发语义）
	if _, busy := m.downloads[string(id)]; busy {
		m.mu.Unlock()
		return nil, fmt.Errorf("该模型已有下载任务进行中（含其他档位）")
	}
	ctx, cancel := context.WithCancel(context.Background())
	ch := make(chan DownloadProgress, 128)
	m.downloads[string(id)] = &downloadHandle{cancel: cancel, quant: quant, spec: spec}
	m.mu.Unlock()
	m.notify()

	go func() {
		defer func() {
			m.mu.Lock()
			delete(m.downloads, string(id))
			m.mu.Unlock()
			m.notify()
		}()
		err := m.startDownload(ctx, spec, quant, ch, m.onProgress)
		if err != nil && ctx.Err() == nil {
			m.log.Error("download failed", "model", id, "err", err)
		}
		close(ch)
	}()
	return ch, nil
}

// CancelDownload 取消进行中的下载。
func (m *Manager) CancelDownload(id ModelID) error {
	m.mu.Lock()
	h, ok := m.downloads[string(id)]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("模型 %s 无进行中下载", id)
	}
	h.cancel()
	return nil
}

// Downloading 判断模型是否在下载。
func (m *Manager) Downloading(id ModelID) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.downloads[string(id)]
	return ok
}

// ---------- Import / Delete / SetActive ----------

// ImportGGUF 从任意路径导入：校验 GGUF 头 → 拷贝入 models/ → 登记。
func (m *Manager) ImportGGUF(srcPath string) (ModelInfo, error) {
	if !strings.HasSuffix(strings.ToLower(srcPath), ".gguf") {
		return ModelInfo{}, fmt.Errorf("仅支持 .gguf 文件")
	}
	meta, err := ReadGGUFMeta(srcPath)
	if err != nil {
		return ModelInfo{}, fmt.Errorf("GGUF 头校验失败: %w", err)
	}
	id := mapNameToID(meta.Name, filepath.Base(srcPath))
	if id == "" {
		return ModelInfo{}, fmt.Errorf("无法识别模型类型（general.name=%q arch=%q）；请放入 models/ 后在模型中心指派", meta.Name, meta.Architecture)
	}
	quant := QuantKind(meta.FileTypeQuant())
	if quant != QuantQ4KM && quant != QuantQ8 {
		// 非标准档位：保留文件名中的档位或默认 Q4_K_M 槽位记录
		quant = QuantKind(guessQuant(srcPath))
	}
	spec, _ := SpecByID(id)
	dst := filepath.Join(paths.ModelsDir(), spec.Files[quant])
	if strings.EqualFold(srcPath, dst) {
		// 已在 models/：直接登记
		return m.registerExisting(dst, id, quant)
	}
	if err := copyFile(srcPath, dst); err != nil {
		return ModelInfo{}, fmt.Errorf("拷贝失败: %w", err)
	}
	return m.registerExisting(dst, id, quant)
}

func (m *Manager) registerExisting(path string, id ModelID, quant QuantKind) (ModelInfo, error) {
	st, err := os.Stat(path)
	if err != nil {
		return ModelInfo{}, err
	}
	sha, err := sha256File(path)
	if err != nil {
		return ModelInfo{}, err
	}
	if err := m.store.UpsertModelFile(store.ModelFileRec{
		ModelID: string(id), Quant: string(quant), FilePath: path,
		SizeBytes: st.Size(), SHA256: sha, VerifiedAt: time.Now().Unix(), Source: "import",
	}); err != nil {
		return ModelInfo{}, err
	}
	m.notify()
	return ModelInfo{ID: string(id), State: StateReady}, nil
}

// AssignUnknown 将 models/ 中的未知文件手动指派为某模型档位（02 文档 §4 现象 B）。
func (m *Manager) AssignUnknown(path string, id ModelID, quant QuantKind) (ModelInfo, error) {
	meta, err := ReadGGUFMeta(path)
	if err != nil {
		return ModelInfo{}, fmt.Errorf("GGUF 头解析失败: %w", err)
	}
	_ = meta
	spec, ok := SpecByID(id)
	if !ok {
		return ModelInfo{}, fmt.Errorf("未知模型 %s", id)
	}
	dst := filepath.Join(paths.ModelsDir(), spec.Files[quant])
	if !strings.EqualFold(path, dst) {
		if err := os.Rename(path, dst); err != nil {
			return ModelInfo{}, err
		}
	}
	return m.registerExisting(dst, id, quant)
}

// Delete 删除模型档位文件（运行中拒绝）。
func (m *Manager) Delete(id ModelID, quant QuantKind) error {
	spec, ok := SpecByID(id)
	if !ok {
		return fmt.Errorf("未知模型 %s", id)
	}
	if m.orch.CurrentModel() == string(id) && m.orch.State() == "running" {
		return fmt.Errorf("模型运行中，无法删除；请先切换模型或等待空闲释放")
	}
	target := filepath.Join(paths.ModelsDir(), spec.Files[quant])
	if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
		return err
	}
	_ = m.store.DeleteModelFileByPath(target)
	m.notify()
	return nil
}

// SetActive 请求 orchestrator 热切换（任务进行中拒绝，ADR-003）。
func (m *Manager) SetActive(id ModelID) error {
	if _, ok := SpecByID(id); !ok {
		return fmt.Errorf("未知模型 %s", id)
	}
	if m.orch.ActiveTasks() > 0 {
		return fmt.Errorf("有翻译/字幕任务进行中，不能切换模型")
	}
	m.mu.Lock()
	m.activeID = string(id)
	m.lastRun[string(id)] = false
	m.mu.Unlock()
	m.notify()
	return nil
}

// MarkRan 记录模型曾运行（休眠态判定），由 app 在 orchestrator running 事件时调用。
func (m *Manager) MarkRan(id string) {
	m.mu.Lock()
	m.lastRun[id] = true
	m.mu.Unlock()
}

// ResolveModelPath 模型+档位 → 本地文件路径（不存在返回错误）。
func (m *Manager) ResolveModelPath(id ModelID) (string, QuantKind, error) {
	spec, ok := SpecByID(id)
	if !ok {
		return "", "", fmt.Errorf("未知模型 %s", id)
	}
	// 优先默认档位，其次任意可用档位
	order := []QuantKind{spec.DefaultQuant}
	for _, q := range AllQuants {
		if q != spec.DefaultQuant {
			order = append(order, q)
		}
	}
	recs, _ := m.store.ListModelFiles()
	for _, q := range order {
		want := filepath.Join(paths.ModelsDir(), spec.Files[q])
		for _, r := range recs {
			if strings.EqualFold(r.FilePath, want) {
				if _, err := os.Stat(want); err == nil {
					return want, q, nil
				}
			}
		}
	}
	// 兜底：登记中该模型的任意文件
	for _, r := range recs {
		if r.ModelID == string(id) {
			if _, err := os.Stat(r.FilePath); err == nil {
				return r.FilePath, QuantKind(guessQuant(r.FilePath)), nil
			}
		}
	}
	return "", "", fmt.Errorf("模型 %s 尚未下载（模型中心下载或从本地导入）", id)
}

// ActiveID 当前激活模型。
func (m *Manager) ActiveID() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.activeID
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst + ".tmp")
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dst + ".tmp")
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(dst + ".tmp")
		return err
	}
	return os.Rename(dst+".tmp", dst)
}

// diskUsage 磁盘剩余空间（GetDiskFreeSpaceEx）。
type diskStat struct{ free, total int64 }

func diskUsage(dir string) diskStat {
	var freeBytes, totalBytes, avail uint64
	p, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		_ = err
		return diskStat{}
	}
	dll := windows.NewLazySystemDLL("kernel32.dll")
	proc := dll.NewProc("GetDiskFreeSpaceExW")
	r1, _, _ := proc.Call(
		uintptr(unsafe.Pointer(p)),
		uintptr(unsafe.Pointer(&avail)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&freeBytes)))
	if r1 == 0 {
		return diskStat{}
	}
	return diskStat{free: int64(freeBytes), total: int64(totalBytes)}
}
