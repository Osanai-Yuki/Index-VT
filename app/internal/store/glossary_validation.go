package store

import (
	"fmt"
	"strings"
)

func ValidateGlossary(g Glossary) (Glossary, error) {
	g.Name = strings.TrimSpace(g.Name)
	if g.Name == "" || len([]rune(g.Name)) > 100 {
		return g, fmt.Errorf("术语本名称需要1–100个字符")
	}
	if len(g.Items) > 5000 {
		return g, fmt.Errorf("术语本上限5000条，请拆分")
	}
	seen := map[string]int{}
	items := make([]GlossaryItemEnt, len(g.Items))
	for i, it := range g.Items {
		it.Term = strings.TrimSpace(it.Term)
		it.Translation = strings.TrimSpace(it.Translation)
		if it.Term == "" || it.Translation == "" {
			return g, fmt.Errorf("第%d条原词或译名为空", i+1)
		}
		if len([]rune(it.Term)) > 256 || len([]rune(it.Translation)) > 4096 {
			return g, fmt.Errorf("第%d条过长", i+1)
		}
		key := strings.ToLower(it.Term)
		if prior, ok := seen[key]; ok {
			return g, fmt.Errorf("第%d条与第%d条原词重复或存在大小写冲突", i+1, prior)
		}
		seen[key] = i + 1
		items[i] = it
	}
	g.Items = items
	return g, nil
}
