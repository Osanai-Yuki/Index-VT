package subtitle

import (
	"bytes"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/encoding/unicode/utf32"
)

var bytesBOMUTF8 = []byte{0xEF, 0xBB, 0xBF}

// DecodeText 编码识别与解码（02 文档 §11.6）：BOM 优先，长 BOM 先判（UTF-32 LE
// 与 UTF-16 LE 前两字节相同，B27）；无 BOM → UTF-8 有效性 → GBK/GB18030 兜底。
// 返回 (文本, 编码名)；每个编码名都对应此处实际使用的解码器（识别与解码同点）。
// 导出：长文档导入（docpipeline 经 app 层）复用同一套识别，避免两处口径漂移。
func DecodeText(raw []byte) (string, string) {
	if bytes.HasPrefix(raw, bytesBOMUTF8) {
		return string(bytes.TrimPrefix(raw, bytesBOMUTF8)), "utf-8-bom"
	}
	// UTF-32 LE BOM（FF FE 00 00）：必须早于 UTF-16 LE 判定（B27）
	if bytes.HasPrefix(raw, []byte{0xFF, 0xFE, 0x00, 0x00}) {
		dec := utf32.UTF32(utf32.LittleEndian, utf32.UseBOM).NewDecoder()
		if out, err := dec.Bytes(raw); err == nil {
			return string(out), "utf-32le"
		}
	}
	// UTF-16 BE（FE FF）：旧实现完全漏判 → 被当 GBK 解码（B27）
	if bytes.HasPrefix(raw, []byte{0xFE, 0xFF}) {
		dec := unicode.UTF16(unicode.BigEndian, unicode.UseBOM).NewDecoder()
		if out, err := dec.Bytes(raw); err == nil {
			return string(out), "utf-16be"
		}
	}
	// UTF-16 LE BOM（少见，容忍）
	if bytes.HasPrefix(raw, []byte{0xFF, 0xFE}) {
		dec := unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewDecoder()
		if out, err := dec.Bytes(raw); err == nil {
			return string(out), "utf-16le"
		}
	}
	if utf8.Valid(raw) {
		return string(raw), "utf-8"
	}
	// GBK 兜底
	dec := simplifiedchinese.GBK.NewDecoder()
	out, err := dec.Bytes(raw)
	if err != nil {
		// GB18030 更全（GBK 超集）
		dec2 := simplifiedchinese.GB18030.NewDecoder()
		out2, err2 := dec2.Bytes(raw)
		if err2 != nil {
			return string(raw), "unknown"
		}
		return string(out2), "gb18030"
	}
	return string(out), "gbk"
}

// encodeGBK 编码为 GBK。
func encodeGBK(s []byte) ([]byte, error) {
	return simplifiedchinese.GBK.NewEncoder().Bytes(s)
}
