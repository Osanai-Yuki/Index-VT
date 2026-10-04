// Package modelmanager 模型档案与下载（01 文档 §5.2）。
// ggufmeta.go：GGUF v3 小端头解析（magic GGUF、64 位字段计数），
// 提取 general.name / general.architecture / general.file_type 供双重识别（02 文档 §4 现象 B）。
package modelmanager

import (
	"encoding/binary"
	"fmt"
	"io"
	"os"
)

const ggufMagic = 0x46554747 // "GGUF" 小端读出

// ggufValueType GGUF 元数据键值类型。
// 注意：以 ggml-org/llama.cpp b11384 的 ggml/include/gguf.h 为准（与 GGUF 规范一致）：
// ARRAY=9、UINT64=10、INT64=11、FLOAT64=12——与旧版 llama.cpp 私有枚举（array=12）不同，
// 本地扫描对官方 Qwen3.5 GGUF 的兼容依赖此点（M2 实测）。
type ggufValueType uint32

const (
	ggufTypeUint8   ggufValueType = 0
	ggufTypeInt8    ggufValueType = 1
	ggufTypeUint16  ggufValueType = 2
	ggufTypeInt16   ggufValueType = 3
	ggufTypeUint32  ggufValueType = 4
	ggufTypeInt32   ggufValueType = 5
	ggufTypeFloat32 ggufValueType = 6
	ggufTypeBool    ggufValueType = 7
	ggufTypeString  ggufValueType = 8
	ggufTypeArray   ggufValueType = 9
	ggufTypeUint64  ggufValueType = 10
	ggufTypeInt64   ggufValueType = 11
	ggufTypeFloat64 ggufValueType = 12
)

func (t ggufValueType) size() int64 {
	switch t {
	case ggufTypeUint8, ggufTypeInt8, ggufTypeBool:
		return 1
	case ggufTypeUint16, ggufTypeInt16:
		return 2
	case ggufTypeUint32, ggufTypeInt32, ggufTypeFloat32:
		return 4
	case ggufTypeUint64, ggufTypeInt64, ggufTypeFloat64:
		return 8
	case ggufTypeString: // 变长：前导 u64 长度
		return -1
	default:
		return -2 // 变长（数组）
	}
}

// GGUFMeta 关注的元数据子集。
type GGUFMeta struct {
	Version      uint32
	TensorCount  uint64
	Name         string // general.name
	Architecture string // general.architecture
	FileType     uint32 // general.file_type（GGML 量化枚举）
	SizeLabel    string // general.size_label（如 "1.9B"）
}

// ggufFileTypeMap GGML_FTYPE / general.file_type 枚举 → 量化名（映射我们关心的档位）。
var ggufFileTypeMap = map[uint32]string{
	0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1",
	7: "Q8_0", 8: "Q5_0", 9: "Q5_1",
	10: "Q2_K", 11: "Q3_K_S", 12: "Q3_K_M", 13: "Q3_K_L",
	14: "Q4_K_S", 15: "Q4_K_M", 16: "Q5_K_S", 17: "Q5_K_M", 18: "Q6_K",
	19: "IQ2_XXS", 20: "IQ2_XS", 21: "Q2_K_S", 22: "IQ3_XS", 23: "IQ3_XXS",
	24: "IQ1_S", 25: "IQ4_NL", 26: "IQ3_S", 27: "IQ3_M", 28: "IQ2_S",
	29: "IQ2_M", 30: "IQ4_XS", 31: "IQ1_M", 32: "BF16",
	36: "TQ1_0", 37: "TQ2_0",
}

// FileTypeQuant 返回量化档位名（未知返回空串）。
func (m GGUFMeta) FileTypeQuant() string { return ggufFileTypeMap[m.FileType] }

// ReadGGUFMeta 流式解析 GGUF 头：只读元数据键值，数组负载 seek 跳过。
// 单值负载上限 64MB（防御异常文件）。
func ReadGGUFMeta(path string) (*GGUFMeta, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return readGGUFMeta(f)
}

func readGGUFMeta(r io.ReadSeeker) (*GGUFMeta, error) {
	var hdr [24]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, fmt.Errorf("读取 GGUF 头失败: %w", err)
	}
	magic := binary.LittleEndian.Uint32(hdr[0:4])
	if magic != ggufMagic {
		return nil, fmt.Errorf("无效 GGUF magic: 0x%08x（文件损坏或非 GGUF）", magic)
	}
	m := &GGUFMeta{
		Version:     binary.LittleEndian.Uint32(hdr[4:8]),
		TensorCount: binary.LittleEndian.Uint64(hdr[8:16]),
	}
	if m.Version < 2 || m.Version > 3 {
		return nil, fmt.Errorf("不支持的 GGUF 版本: %d", m.Version)
	}
	kvCount := binary.LittleEndian.Uint64(hdr[16:24])

	const maxSingleValue = 64 << 20
	for i := uint64(0); i < kvCount; i++ {
		key, err := readGGUFString(r)
		if err != nil {
			return nil, fmt.Errorf("读取 key#%d: %w", i, err)
		}
		var vtBuf [4]byte
		if _, err := io.ReadFull(r, vtBuf[:]); err != nil {
			return nil, fmt.Errorf("读取 valtype(%s): %w", key, err)
		}
		vt := ggufValueType(binary.LittleEndian.Uint32(vtBuf[:]))
		switch key {
		case "general.name":
			s, err := readGGUFString(r)
			if err != nil {
				return nil, err
			}
			m.Name = s
		case "general.architecture":
			s, err := readGGUFString(r)
			if err != nil {
				return nil, err
			}
			m.Architecture = s
		case "general.file_type":
			if err := binary.Read(r, binary.LittleEndian, &m.FileType); err != nil {
				return nil, err
			}
		case "general.size_label":
			s, err := readGGUFString(r)
			if err != nil {
				return nil, err
			}
			m.SizeLabel = s
		default:
			if err := skipGGUFValue(r, vt, maxSingleValue); err != nil {
				return nil, fmt.Errorf("跳过 %s: %w", key, err)
			}
		}
	}
	return m, nil
}

func readGGUFString(r io.Reader) (string, error) {
	var lBuf [8]byte
	if _, err := io.ReadFull(r, lBuf[:]); err != nil {
		return "", err
	}
	n := binary.LittleEndian.Uint64(lBuf[:])
	if n > 16<<20 { // 单字符串上限 16MB（防异常文件）
		return "", fmt.Errorf("字符串长度异常: %d", n)
	}
	b := make([]byte, n)
	if _, err := io.ReadFull(r, b); err != nil {
		return "", err
	}
	return string(b), nil
}

func skipGGUFValue(r io.ReadSeeker, vt ggufValueType, maxSingle int64) error {
	skipN := func(n int64) error {
		if n > maxSingle {
			return fmt.Errorf("负载超限: %d", n)
		}
		_, err := r.Seek(n, io.SeekCurrent)
		return err
	}
	switch vt {
	case ggufTypeString:
		var lBuf [8]byte
		if _, err := io.ReadFull(r, lBuf[:]); err != nil {
			return err
		}
		n := int64(binary.LittleEndian.Uint64(lBuf[:]))
		return skipN(n)
	case ggufTypeArray:
		// [elem_type u32][count u64][payload]
		var tBuf [12]byte
		if _, err := io.ReadFull(r, tBuf[:]); err != nil {
			return err
		}
		elemType := ggufValueType(binary.LittleEndian.Uint32(tBuf[0:4]))
		count := int64(binary.LittleEndian.Uint64(tBuf[4:12]))
		es := elemType.size()
		if es > 0 {
			return skipN(es * count)
		}
		if es == -1 { // string 数组：逐个读长度+跳过
			for i := int64(0); i < count; i++ {
				if err := skipGGUFValue(r, ggufTypeString, maxSingle); err != nil {
					return err
				}
			}
			return nil
		}
		return fmt.Errorf("不支持的数组元素类型 %d", elemType)
	default:
		if s := vt.size(); s > 0 {
			return skipN(s)
		}
		return fmt.Errorf("不支持的值类型 %d", vt)
	}
}
