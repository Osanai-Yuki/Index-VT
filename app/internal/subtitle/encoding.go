package subtitle

import (
	"bytes"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
)

var bytesBOMUTF8 = []byte{0xEF, 0xBB, 0xBF}

// decodeText 编码识别（02 文档 §11.6）：UTF-8 BOM → UTF-8 有效性 → GBK。
func decodeText(raw []byte) (string, string) {
	if bytes.HasPrefix(raw, bytesBOMUTF8) {
		return string(bytes.TrimPrefix(raw, bytesBOMUTF8)), "utf-8-bom"
	}
	if bytes.HasPrefix(raw, []byte{0xFF, 0xFE}) { // UTF-16 LE BOM（少见，容忍）
		dec := unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewDecoder()
		if out, err := dec.Bytes(raw); err == nil {
			return string(out), "utf-16"
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
