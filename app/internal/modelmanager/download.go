package modelmanager

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"indexvt/internal/paths"
	"indexvt/internal/store"
)

// SourceKind 下载源。
type SourceKind string

const (
	SourceHF SourceKind = "hf"
	SourceMS SourceKind = "modelscope"
)

// DownloadProgress 进度快照（Wails 事件 model:progress 载荷）。
type DownloadProgress struct {
	ModelID    string  `json:"modelId"`
	Quant      string  `json:"quant"`
	Phase      string  `json:"phase"` // probing|downloading|verifying|done|failed|canceled
	BytesDone  int64   `json:"bytesDone"`
	BytesTotal int64   `json:"bytesTotal"`
	SpeedBPS   float64 `json:"speedBPS"`
	Source     string  `json:"source"`
	Message    string  `json:"message,omitempty"`
}

// sourceURLs 按源生成文件直链（02 文档 §4 现象 C：ModelScope 直链格式 M2 实测有效）。
func sourceURLs(repo, file string) map[SourceKind]string {
	return map[SourceKind]string{
		SourceHF: fmt.Sprintf("https://huggingface.co/%s/resolve/main/%s", repo, file),
		SourceMS: fmt.Sprintf("https://modelscope.cn/models/%s/resolve/master/%s", repo, file),
	}
}

// ---------- SSRF 防护：主机白名单 + 私网地址拒绝 ----------

var allowedHostSuffixes = []string{
	".huggingface.co", "huggingface.co",
	".hf.co", "hf.co",
	".modelscope.cn", "modelscope.cn",
	".modelscope.org", "modelscope.org",
	".aliyuncs.com", // ModelScope CDN（OSS）
}

func isAllowedURL(u *url.URL) bool {
	// B18③：仅 https。明文 http 可被中间人整体替换 GGUF，而落盘文件随后
	// 由 llama-server 解析执行 —— 完整性不能靠明文传输兜底。
	if u.Scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	// IP 字面量：拒绝环回 / 私网 / 链路本地 / 组播 / 未指定（含云元数据端点
	// 169.254.169.254）。复用 isPrivateOrReserved（与 guardedDialContext 的
	// DNS-pin 共用同一份判定），避免本文件出现两份「私有/保留」谓词。
	if ip := net.ParseIP(host); ip != nil {
		if isPrivateOrReserved(ip) {
			return false
		}
	}
	if host == "localhost" {
		return false
	}
	for _, s := range allowedHostSuffixes {
		if host == s || strings.HasSuffix(host, s) {
			return true
		}
	}
	return false
}

func guardedDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ip := net.ParseIP(host)
	if ip == nil {
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("域名解析为空: %s", host)
		}
		ip = ips[0].IP
	}
	if isPrivateOrReserved(ip) {
		return nil, fmt.Errorf("拒绝连接保留/私网地址: %s", ip)
	}
	var d net.Dialer
	return d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
}

func isPrivateOrReserved(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified()
}

func newDownloadClient() *http.Client {
	return &http.Client{
		Timeout: 0, // 下载主体不限时；探活/HEAD 用带超时的独立 client
		Transport: &http.Transport{
			DialContext:           guardedDialContext,
			MaxIdleConns:          4,
			IdleConnTimeout:       60 * time.Second,
			ResponseHeaderTimeout: 20 * time.Second,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 6 {
				return errors.New("重定向次数过多")
			}
			if !isAllowedURL(req.URL) {
				return fmt.Errorf("重定向目标被拒绝: %s", req.URL)
			}
			return nil
		},
	}
}

// ---------- 探测 ----------

type sourceProbe struct {
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latencyMs"`
	ETag      string `json:"etag,omitempty"`
	Size      int64  `json:"size"`
	Err       string `json:"err,omitempty"`
}

// ProbeSources 并发 HEAD 探测双源（5s 超时；02 文档 §4 现象 C）。
func ProbeSources(repo, file string) map[SourceKind]*sourceProbe {
	urls := sourceURLs(repo, file)
	out := make(map[SourceKind]*sourceProbe, 2)
	var mu sync.Mutex
	var wg sync.WaitGroup
	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			DialContext: guardedDialContext,
		},
	}
	for kind, u := range urls {
		wg.Add(1)
		go func(kind SourceKind, u string) {
			defer wg.Done()
			p := &sourceProbe{}
			start := time.Now()
			req, err := http.NewRequest(http.MethodHead, u, nil)
			if err != nil {
				p.Err = err.Error()
			} else {
				resp, err := client.Do(req)
				if err != nil {
					p.Err = err.Error()
				} else {
					defer resp.Body.Close()
					p.LatencyMs = time.Since(start).Milliseconds()
					if resp.StatusCode == http.StatusOK {
						p.OK = true
						p.ETag = resp.Header.Get("ETag")
						p.Size = resp.ContentLength
					} else {
						p.Err = fmt.Sprintf("HTTP %d", resp.StatusCode)
					}
				}
			}
			mu.Lock()
			out[kind] = p
			mu.Unlock()
		}(kind, u)
	}
	wg.Wait()
	return out
}

// chooseSource 探测择优：连通性优先；HF 不可达或延迟 >3× ModelScope 时选 MS
// （01 文档 §5.2）。pref 强制时直选（仅当该源连通）。
func chooseSource(probes map[SourceKind]*sourceProbe, pref string) (SourceKind, error) {
	hf, ms := probes[SourceHF], probes[SourceMS]
	switch pref {
	case "hf":
		if hf != nil && hf.OK {
			return SourceHF, nil
		}
		return "", fmt.Errorf("HF 源不可达且已强制优先 HF")
	case "modelscope":
		if ms != nil && ms.OK {
			return SourceMS, nil
		}
		return "", fmt.Errorf("ModelScope 源不可达且已强制优先 ModelScope")
	}
	hfOK := hf != nil && hf.OK
	msOK := ms != nil && ms.OK
	switch {
	case hfOK && msOK:
		if hf.LatencyMs > 3*ms.LatencyMs {
			return SourceMS, nil
		}
		return SourceHF, nil
	case hfOK:
		return SourceHF, nil
	case msOK:
		return SourceMS, nil
	default:
		return "", fmt.Errorf("双源均不可达（HF: %v；ModelScope: %v）", hfErr(hf), msErr(ms))
	}
}

func hfErr(p *sourceProbe) string {
	if p == nil {
		return "无结果"
	}
	return p.Err
}
func msErr(p *sourceProbe) string {
	if p == nil {
		return "无结果"
	}
	return p.Err
}

// ---------- .part 元数据（同源续传依据，02 文档 §4 现象 A） ----------

type partMeta struct {
	URL     string `json:"url"` // 完整源 URL（含源身份）
	ETag    string `json:"etag"`
	Size    int64  `json:"size"`
	ModelID string `json:"modelId"`
	Quant   string `json:"quant"`
}

func partPaths(final string) (string, string) {
	return final + ".part", final + ".part.json"
}

// ---------- 下载器 ----------

// maxDownloadBytes 无 Content-Length 时的熔断上限（4GB，覆盖三模型最大档位）。
// 修 B18②：total==0 时旧代码的 `if total > 0 && done != total` 整个跳过体积检查。
const maxDownloadBytes int64 = 4 << 30

// startDownload 执行一次完整下载流程（供 Download/重试调用）。
// ch 接收进度快照；emit 同时回调 app 层（Wails 事件广播）。
func (m *Manager) startDownload(ctx context.Context, spec ModelSpec, quant QuantKind, ch chan<- DownloadProgress, emit func(DownloadProgress)) error {
	file := spec.Files[quant]
	finalPath := filepath.Join(paths.ModelsDir(), file)
	progress := func(p DownloadProgress) {
		p.ModelID = string(spec.ID)
		p.Quant = string(quant)
		select {
		case ch <- p:
		default:
		}
		if emit != nil {
			emit(p)
		}
	}
	fail := func(msg string) error {
		progress(DownloadProgress{Phase: "failed", Message: msg, Source: m.currentSource(string(spec.ID))})
		return errors.New(msg)
	}

	// 磁盘空间检查（×1.2，02 文档 §4 现象 D）
	approx := spec.ApproxSizes[quant]
	if err := checkDiskSpace(paths.ModelsDir(), approx); err != nil {
		return fail(err.Error())
	}

	// 1. 双源探测
	progress(DownloadProgress{Phase: "probing", Message: "探测 HF / ModelScope 双源…"})
	probes := ProbeSources(spec.Repo, file)
	chosen, err := chooseSource(probes, m.sourcePref())
	if err != nil {
		return fail(err.Error())
	}
	m.setCurrentSource(string(spec.ID), string(chosen))
	progress(DownloadProgress{Phase: "probing", Source: string(chosen),
		Message: fmt.Sprintf("择优结果: %s（HF %v / ModelScope %v）", chosen, probeMs(probes[SourceHF]), probeMs(probes[SourceMS]))})
	urls := sourceURLs(spec.Repo, file)
	targetURL := urls[chosen]

	// 2. 同源断点续传判定
	partFile, metaFile := partPaths(finalPath)
	var resumeFrom int64
	var prevETag string
	if data, err := os.ReadFile(metaFile); err == nil {
		var pm partMeta
		if json.Unmarshal(data, &pm) == nil && pm.URL == targetURL {
			if st, err := os.Stat(partFile); err == nil && st.Size() > 0 && (pm.Size <= 0 || st.Size() <= pm.Size) {
				resumeFrom = st.Size()
				prevETag = pm.ETag
			}
		}
	}
	if resumeFrom == 0 {
		_ = os.Remove(partFile)
		_ = os.Remove(metaFile)
	}

	// 3. 请求（Range 仅同源）
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return fail(err.Error())
	}
	if resumeFrom > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", resumeFrom))
		progress(DownloadProgress{Phase: "downloading", Source: string(chosen), BytesDone: resumeFrom,
			Message: fmt.Sprintf("同源断点续传，从 %d 字节继续", resumeFrom)})
	} else {
		progress(DownloadProgress{Phase: "downloading", Source: string(chosen)})
	}
	resp, err := newDownloadClient().Do(req)
	if err != nil {
		if ctx.Err() != nil {
			progress(DownloadProgress{Phase: "canceled", Source: string(chosen), Message: "已取消"})
			return nil
		}
		return fail("下载请求失败: " + err.Error())
	}
	defer resp.Body.Close()
	switch {
	case resumeFrom > 0 && resp.StatusCode == http.StatusPartialContent:
		// 续传成功
	case resumeFrom > 0 && resp.StatusCode == http.StatusOK:
		// 服务端不支持 Range → 重下
		resumeFrom = 0
	case resp.StatusCode != http.StatusOK:
		return fail(fmt.Sprintf("HTTP %d", resp.StatusCode))
	}
	total := resp.ContentLength + resumeFrom
	newETag := resp.Header.Get("ETag")
	// 同源 ETag 变化 → 内容已更新，丢弃 .part 重下（02 文档 §4：续传仅限同源同内容）
	if resumeFrom > 0 && prevETag != "" && newETag != "" && prevETag != newETag {
		resp.Body.Close()
		_ = os.Remove(partFile)
		_ = os.Remove(metaFile)
		m.log.Warn("ETag 变化，.part 作废重下", "model", spec.ID)
		return m.startDownload(ctx, spec, quant, ch, emit)
	}

	// 写 .part + 元数据
	var out *os.File
	if resumeFrom > 0 {
		out, err = os.OpenFile(partFile, os.O_WRONLY|os.O_APPEND, 0o644)
	} else {
		out, err = os.Create(partFile)
	}
	if err != nil {
		return fail("写 .part 失败: " + err.Error())
	}
	meta, _ := json.Marshal(partMeta{URL: targetURL, ETag: newETag, Size: total, ModelID: string(spec.ID), Quant: string(quant)})
	_ = os.WriteFile(metaFile, meta, 0o644)

	// 4. 流式拷贝 + 限频进度（200ms）
	done := resumeFrom
	var lastEmit time.Time
	speedWindow := newSpeedWindow()
	buf := make([]byte, 256<<10)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := out.Write(buf[:n]); werr != nil {
				out.Close()
				return fail("写盘失败: " + werr.Error())
			}
			done += int64(n)
			if done > maxDownloadBytes {
				out.Close()
				return fail(fmt.Sprintf("已下载 %d 字节超过上限 %d，连接已切断（.part 已保留）", done, maxDownloadBytes))
			}
			speedWindow.add(n)
			if time.Since(lastEmit) >= 200*time.Millisecond {
				lastEmit = time.Now()
				progress(DownloadProgress{Phase: "downloading", BytesDone: done, BytesTotal: total,
					SpeedBPS: speedWindow.bps(), Source: string(chosen)})
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			out.Close()
			if ctx.Err() != nil {
				progress(DownloadProgress{Phase: "canceled", Source: string(chosen), Message: "已取消"})
				return nil
			}
			// 中断：保留 .part 供同源续传
			return fail("下载中断（.part 已保留，可断点续传）: " + rerr.Error())
		}
	}
	out.Close()
	cancelled := func() bool {
		if ctx.Err() == nil {
			return false
		}
		progress(DownloadProgress{Phase: "canceled", Source: string(chosen), Message: "已停止下载或校验，进度保留，可再次下载续传"})
		return true
	}
	if cancelled() {
		return nil
	}

	if total > 0 && done != total {
		return fail(fmt.Sprintf("体积不符: 已下 %d / 预期 %d", done, total))
	}
	progress(DownloadProgress{Phase: "verifying", BytesDone: done, BytesTotal: total, Source: string(chosen), Message: "SHA256 校验中…"})

	// 5. SHA256 校验（优先官方 SHA256SUMS.txt）
	official, offErr := fetchOfficialSHA256(ctx, spec.Repo, file, chosen)
	if cancelled() {
		return nil
	}
	got, err := sha256FileContext(ctx, partFile)
	if cancelled() {
		return nil
	}
	if err != nil {
		return fail("SHA256 计算失败: " + err.Error())
	}
	if verr := verifyIntegrity(official, offErr, got); verr != nil {
		if !errors.Is(verr, ErrChecksumUnavailable) {
			// 确认损坏：删除，避免留下会被误装的坏文件（坏字节也不可续传复用）。
			_ = os.Remove(partFile)
			_ = os.Remove(metaFile)
		}
		// 暂不可得（网络/上游）：保留 .part 与 sidecar，用户可稍后重试，无需重新下载。
		return fail(verr.Error())
	}

	// 6. 原子重命名 + 登记
	if err := os.Rename(partFile, finalPath); err != nil {
		return fail("原子重命名失败: " + err.Error())
	}
	_ = os.Remove(metaFile)
	if err := m.store.UpsertModelFile(store.ModelFileRec{
		ModelID: string(spec.ID), Quant: string(quant), FilePath: finalPath,
		SizeBytes: done, SHA256: got, VerifiedAt: time.Now().Unix(), Source: string(chosen),
	}); err != nil {
		return fail("登记失败: " + err.Error())
	}
	progress(DownloadProgress{Phase: "done", BytesDone: done, BytesTotal: done, Source: string(chosen)})
	return nil
}

func probeMs(p *sourceProbe) string {
	if p == nil || !p.OK {
		return "不可达"
	}
	return fmt.Sprintf("%dms", p.LatencyMs)
}

// fetchOfficialSHA256 从所选源拉取 SHA256SUMS.txt 并取目标文件哈希。
func fetchOfficialSHA256(ctx context.Context, repo, file string, kind SourceKind) (string, error) {
	var u string
	switch kind {
	case SourceMS:
		u = fmt.Sprintf("https://modelscope.cn/models/%s/resolve/master/SHA256SUMS.txt", repo)
	default:
		u = fmt.Sprintf("https://huggingface.co/%s/resolve/main/SHA256SUMS.txt", repo)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	resp, err := newDownloadClient().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) == 2 && strings.EqualFold(fields[1], file) {
			return strings.ToLower(fields[0]), nil
		}
	}
	return "", fmt.Errorf("SHA256SUMS 中未找到 %s", file)
}

// ErrChecksumUnavailable 官方校验和暂不可得（网络/上游问题，非内容损坏）。
// 用于区分「拒绝安装但保留下载文件（可稍后重试）」与「确认损坏，删除重下」。
var ErrChecksumUnavailable = errors.New("官方 SHA256SUMS 暂不可得")

// verifyIntegrity 判定下载完整性。fail-closed：拿不到官方校验和即拒绝。
// 理由：落盘文件随后会被 llama-server 解析执行，恶意/损坏 GGUF 经张量解析
// 即构成以用户权限执行代码的路径。本版不提供 allowUnverified 风险放行开关
// （属新增能力，PRD R-7 决定不做）。
// 「暂不可得」（fetch 失败 / SHA256SUMS 缺条目）以 ErrChecksumUnavailable 标出：
// 调用方拒绝安装但保留下载文件，用户可稍后重试；「校验不一致」为确认损坏，
// 保持普通错误，调用方删除文件重下。
func verifyIntegrity(official string, officialErr error, got string) error {
	if officialErr != nil {
		return fmt.Errorf("无法获取官方 SHA256SUMS（%w），拒绝安装未校验模型；下载文件已保留，可稍后重试，无需重新下载: %w", officialErr, ErrChecksumUnavailable)
	}
	if official == "" {
		return fmt.Errorf("官方 SHA256SUMS 缺少该文件条目，暂无法校验，拒绝安装未校验模型；下载文件已保留，可稍后重试: %w", ErrChecksumUnavailable)
	}
	if !strings.EqualFold(official, got) {
		return fmt.Errorf("SHA256 校验失败：期望 %s，实际 %s", official, got)
	}
	return nil
}

func sha256File(path string) (string, error) {
	return sha256FileContext(context.Background(), path)
}

func sha256FileContext(ctx context.Context, path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	buf := make([]byte, 1<<22)
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		n, rerr := f.Read(buf)
		if n > 0 {
			h.Write(buf[:n])
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return "", rerr
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func checkDiskSpace(dir string, needBytes int64) error {
	need := needBytes + needBytes/5 // ×1.2
	du := diskUsage(dir)
	if du.total > 0 && du.free < need {
		return fmt.Errorf("磁盘剩余 %.1fGB 不足（需 %.1fGB）", float64(du.free)/(1<<30), float64(need)/(1<<30))
	}
	return nil
}

type DownloadLocation struct {
	Path      string `json:"path"`
	FreeBytes int64  `json:"freeBytes"`
	Known     bool   `json:"known"`
}

func GetDownloadLocation() DownloadLocation {
	dir := paths.ModelsDir()
	du := diskUsage(dir)
	return DownloadLocation{Path: dir, FreeBytes: du.free, Known: du.total > 0}
}

// speedWindow 简单滑动窗口测速。
type speedWindow struct {
	mu     sync.Mutex
	bytes  int64
	window time.Time
	last   float64
}

func newSpeedWindow() *speedWindow { return &speedWindow{window: time.Now()} }

func (s *speedWindow) add(n int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bytes += int64(n)
	elapsed := time.Since(s.window)
	if elapsed >= 700*time.Millisecond {
		s.last = float64(s.bytes) / elapsed.Seconds()
		s.bytes = 0
		s.window = time.Now()
	}
}

func (s *speedWindow) bps() float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.last > 0 {
		return s.last
	}
	elapsed := time.Since(s.window).Seconds()
	if elapsed < 0.2 {
		return 0
	}
	return float64(s.bytes) / elapsed
}
