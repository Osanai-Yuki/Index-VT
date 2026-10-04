// Package store 持久化层：modernc.org/sqlite（纯 Go，免 CGO——ADR-001）。
// 位置：models/data/indexvt.db（便携布局，01 文档 §8）。
// 安全约束：全部外部输入使用参数绑定，禁止字符串拼接 SQL。
package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const schemaVersion = 1

type Store struct {
	db *sql.DB
}

// Open 打开（必要时创建）数据库并执行迁移。
func Open(path string) (*Store, error) {
	// modernc 驱动 DSN：WAL + 忙等 5s + 外键开启
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1) // 单写者模型，规避 SQLITE_BUSY
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	var v int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return err
	}
	if v > schemaVersion {
		return fmt.Errorf("数据库版本 %d 高于程序支持的 %d", v, schemaVersion)
	}
	if v == schemaVersion {
		return nil
	}
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS history(
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			created_at INTEGER NOT NULL,
			source_lang TEXT NOT NULL,
			target_lang TEXT NOT NULL,
			source_text TEXT NOT NULL,
			output TEXT NOT NULL,
			model TEXT NOT NULL,
			mode TEXT NOT NULL DEFAULT '',
			starred INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS glossaries(
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS glossary_items(
			glossary_id INTEGER NOT NULL REFERENCES glossaries(id) ON DELETE CASCADE,
			term TEXT NOT NULL,
			translation TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS config(
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS model_files(
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			model_id TEXT NOT NULL,
			quant TEXT NOT NULL,
			file_path TEXT NOT NULL UNIQUE,
			size_bytes INTEGER NOT NULL,
			sha256 TEXT NOT NULL DEFAULT '',
			verified_at INTEGER NOT NULL DEFAULT 0,
			source TEXT NOT NULL DEFAULT ''
		)`,
	}
	for _, q := range stmts {
		if _, err := s.db.Exec(q); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	if _, err := s.db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, schemaVersion)); err != nil {
		return err
	}
	return nil
}

// ---------- config ----------

func (s *Store) GetConfig(key string, out any) (bool, error) {
	var raw string
	err := s.db.QueryRow(`SELECT value FROM config WHERE key = ?`, key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal([]byte(raw), out); err != nil {
		return false, fmt.Errorf("config %s: %w", key, err)
	}
	return true, nil
}

func (s *Store) SetConfig(key string, val any) error {
	raw, err := json.Marshal(val)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO config(key, value) VALUES(?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, string(raw))
	return err
}

// ---------- history ----------

type HistoryItem struct {
	ID         int64  `json:"id"`
	CreatedAt  int64  `json:"createdAt"`
	SourceLang string `json:"sourceLang"`
	TargetLang string `json:"targetLang"`
	SourceText string `json:"sourceText"`
	Output     string `json:"output"`
	Model      string `json:"model"`
	Mode       string `json:"mode"`
	Starred    bool   `json:"starred"`
}

func (s *Store) AddHistory(h HistoryItem) (int64, error) {
	h.CreatedAt = time.Now().Unix()
	res, err := s.db.Exec(`INSERT INTO history(created_at, source_lang, target_lang, source_text, output, model, mode, starred)
		VALUES(?,?,?,?,?,?,?,?)`,
		h.CreatedAt, h.SourceLang, h.TargetLang, h.SourceText, h.Output, h.Model, h.Mode, boolInt(h.Starred))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) ListHistory(page, pageSize int, starredOnly bool) ([]HistoryItem, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 50
	}
	q := `SELECT id, created_at, source_lang, target_lang, source_text, output, model, mode, starred
		FROM history`
	args := []any{}
	if starredOnly {
		q += ` WHERE starred = 1`
	}
	q += ` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
	args = append(args, pageSize, (page-1)*pageSize)
	return s.queryHistory(q, args...)
}

func (s *Store) SearchHistory(q string, limit int) ([]HistoryItem, error) {
	if limit < 1 || limit > 200 {
		limit = 50
	}
	if q == "" {
		return s.ListHistory(1, limit, false)
	}
	like := "%" + likeEscape(q) + "%"
	return s.queryHistory(`SELECT id, created_at, source_lang, target_lang, source_text, output, model, mode, starred
		FROM history WHERE source_text LIKE ? ESCAPE '\' OR output LIKE ? ESCAPE '\'
		ORDER BY created_at DESC, id DESC LIMIT ?`, like, like, limit)
}

func likeEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

func (s *Store) queryHistory(q string, args ...any) ([]HistoryItem, error) {
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []HistoryItem
	for rows.Next() {
		var h HistoryItem
		var starred int
		if err := rows.Scan(&h.ID, &h.CreatedAt, &h.SourceLang, &h.TargetLang, &h.SourceText, &h.Output, &h.Model, &h.Mode, &starred); err != nil {
			return nil, err
		}
		h.Starred = starred != 0
		out = append(out, h)
	}
	return out, rows.Err()
}

func (s *Store) DeleteHistory(id int64) error {
	_, err := s.db.Exec(`DELETE FROM history WHERE id = ?`, id)
	return err
}

func (s *Store) StarHistory(id int64, starred bool) error {
	_, err := s.db.Exec(`UPDATE history SET starred = ? WHERE id = ?`, boolInt(starred), id)
	return err
}

func (s *Store) ClearHistory() error {
	_, err := s.db.Exec(`DELETE FROM history`)
	return err
}

func (s *Store) TrimHistory(maxEntries int) error {
	if maxEntries <= 0 {
		return nil
	}
	_, err := s.db.Exec(`DELETE FROM history WHERE id NOT IN (
		SELECT id FROM history ORDER BY created_at DESC, id DESC LIMIT ?)`, maxEntries)
	return err
}

// ---------- glossaries ----------

type Glossary struct {
	ID    int64             `json:"id"`
	Name  string            `json:"name"`
	Items []GlossaryItemEnt `json:"items"`
}

type GlossaryItemEnt struct {
	Term        string `json:"term"`
	Translation string `json:"translation"`
}

func (s *Store) ListGlossaries() ([]Glossary, error) {
	rows, err := s.db.Query(`SELECT id, name FROM glossaries ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Glossary
	for rows.Next() {
		var g Glossary
		if err := rows.Scan(&g.ID, &g.Name); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		items, err := s.glossaryItems(out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Items = items
	}
	return out, nil
}

func (s *Store) glossaryItems(id int64) ([]GlossaryItemEnt, error) {
	rows, err := s.db.Query(`SELECT term, translation FROM glossary_items WHERE glossary_id = ? ORDER BY rowid`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []GlossaryItemEnt
	for rows.Next() {
		var it GlossaryItemEnt
		if err := rows.Scan(&it.Term, &it.Translation); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

// SaveGlossary id=0 新建；否则整体替换。
func (s *Store) SaveGlossary(g Glossary) (int64, error) {
	if g.ID == 0 {
		res, err := s.db.Exec(`INSERT INTO glossaries(name) VALUES(?)`, g.Name)
		if err != nil {
			return 0, err
		}
		g.ID, err = res.LastInsertId()
		if err != nil {
			return 0, err
		}
	} else {
		if _, err := s.db.Exec(`UPDATE glossaries SET name = ? WHERE id = ?`, g.Name, g.ID); err != nil {
			return 0, err
		}
		if _, err := s.db.Exec(`DELETE FROM glossary_items WHERE glossary_id = ?`, g.ID); err != nil {
			return 0, err
		}
	}
	for _, it := range g.Items {
		if it.Term == "" {
			continue
		}
		if _, err := s.db.Exec(`INSERT INTO glossary_items(glossary_id, term, translation) VALUES(?,?,?)`,
			g.ID, it.Term, it.Translation); err != nil {
			return 0, err
		}
	}
	return g.ID, nil
}

func (s *Store) DeleteGlossary(id int64) error {
	if _, err := s.db.Exec(`DELETE FROM glossary_items WHERE glossary_id = ?`, id); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM glossaries WHERE id = ?`, id)
	return err
}

// ---------- model_files（本地模型登记表） ----------

type ModelFileRec struct {
	ModelID    string
	Quant      string
	FilePath   string
	SizeBytes  int64
	SHA256     string
	VerifiedAt int64
	Source     string
}

func (s *Store) UpsertModelFile(rec ModelFileRec) error {
	_, err := s.db.Exec(`INSERT INTO model_files(model_id, quant, file_path, size_bytes, sha256, verified_at, source)
		VALUES(?,?,?,?,?,?,?)
		ON CONFLICT(file_path) DO UPDATE SET
		  model_id=excluded.model_id, quant=excluded.quant, size_bytes=excluded.size_bytes,
		  sha256=excluded.sha256, verified_at=excluded.verified_at, source=excluded.source`,
		rec.ModelID, rec.Quant, rec.FilePath, rec.SizeBytes, rec.SHA256, rec.VerifiedAt, rec.Source)
	return err
}

func (s *Store) ListModelFiles() ([]ModelFileRec, error) {
	rows, err := s.db.Query(`SELECT model_id, quant, file_path, size_bytes, sha256, verified_at, source FROM model_files`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ModelFileRec
	for rows.Next() {
		var r ModelFileRec
		if err := rows.Scan(&r.ModelID, &r.Quant, &r.FilePath, &r.SizeBytes, &r.SHA256, &r.VerifiedAt, &r.Source); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) DeleteModelFileByPath(path string) error {
	_, err := s.db.Exec(`DELETE FROM model_files WHERE file_path = ?`, path)
	return err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
