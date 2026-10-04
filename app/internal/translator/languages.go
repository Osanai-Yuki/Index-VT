// Package translator 翻译编排（01 文档 §5.3/§4）：prompt 构造（逐字移植官方模板）、
// OpenAI 兼容流式调用、取消传播、off-target 粗检、语言清单。
package translator

// Lang 语言条目。Code 为 UI 标识（首个官方别名）；
// ZhName 为官方 prompt 构造用中文名（训练侧 LANG_NAMES 同源）；
// Script 为期望文字系统（off-target 检测与 auto 检测用）。
type Lang struct {
	Code    string `json:"code"`
	ZhName  string `json:"zhName"`
	EnName  string `json:"enName"`
	Script  string `json:"script"`
	Core    bool   `json:"core,omitempty"` // 22 核心语言（UI 置顶）
}

// Languages 官方 150 语言清单（Index_Translate_Series_Technical_Report.pdf 表 31/32，
// 2026-10 附录 C "Supported Languages and Identifiers"：22 核心 + 128 扩展）。
var Languages = []Lang{
	// ---- 核心 22 ----
	{"en", "英语", "English", "Latin", true},
	{"zh", "中文", "Chinese", "Han", true},
	{"de", "德语", "German", "Latin", true},
	{"fr", "法语", "French", "Latin", true},
	{"es", "西班牙语", "Spanish", "Latin", true},
	{"ja", "日语", "Japanese", "Japanese", true},
	{"ko", "韩语", "Korean", "Hangul", true},
	{"pt", "葡萄牙语", "Portuguese", "Latin", true},
	{"ru", "俄语", "Russian", "Cyrillic", true},
	{"ar", "阿拉伯语", "Arabic", "Arabic", true},
	{"it", "意大利语", "Italian", "Latin", true},
	{"nl", "荷兰语", "Dutch", "Latin", true},
	{"pl", "波兰语", "Polish", "Latin", true},
	{"ro", "罗马尼亚语", "Romanian", "Latin", true},
	{"sv", "瑞典语", "Swedish", "Latin", true},
	{"tr", "土耳其语", "Turkish", "Latin", true},
	{"hi", "印地语", "Hindi", "Devanagari", true},
	{"vi", "越南语", "Vietnamese", "Latin", true},
	{"th", "泰语", "Thai", "Thai", true},
	{"id", "印尼语", "Indonesian", "Latin", true},
	{"ms", "马来语", "Malay", "Latin", true},
	{"fil", "菲律宾语", "Filipino", "Latin", true},
	// ---- 扩展 128 ----
	{"ukr_Cyrl", "乌克兰语", "Ukrainian", "Cyrillic", false},
	{"fas_Arab", "波斯语", "Persian", "Arabic", false},
	{"pes_Arab", "波斯语", "Persian", "Arabic", false},
	{"ces_Latn", "捷克语", "Czech", "Latin", false},
	{"ell_Grek", "希腊语", "Greek", "Greek", false},
	{"dan_Latn", "丹麦语", "Danish", "Latin", false},
	{"hun_Latn", "匈牙利语", "Hungarian", "Latin", false},
	{"fin_Latn", "芬兰语", "Finnish", "Latin", false},
	{"nob_Latn", "书面挪威语", "Norwegian Bokmål", "Latin", false},
	{"slk_Latn", "斯洛伐克语", "Slovak", "Latin", false},
	{"bul_Cyrl", "保加利亚语", "Bulgarian", "Cyrillic", false},
	{"bos_Latn", "波斯尼亚语", "Bosnian", "Latin", false},
	{"cat_Latn", "加泰罗尼亚语", "Catalan", "Latin", false},
	{"ben_Beng", "孟加拉语", "Bengali", "Bengali", false},
	{"heb_Hebr", "希伯来语", "Hebrew", "Hebrew", false},
	{"lit_Latn", "立陶宛语", "Lithuanian", "Latin", false},
	{"slv_Latn", "斯洛文尼亚语", "Slovenian", "Latin", false},
	{"ekk_Latn", "爱沙尼亚语", "Estonian", "Latin", false},
	{"als_Latn", "阿尔巴尼亚语", "Albanian", "Latin", false},
	{"lvs_Latn", "拉脱维亚语", "Latvian", "Latin", false},
	{"azj_Latn", "阿塞拜疆语", "Azerbaijani", "Latin", false},
	{"hrv_Latn", "克罗地亚语", "Croatian", "Latin", false},
	{"tam_Taml", "泰米尔语", "Tamil", "Tamil", false},
	{"npi_Deva", "尼泊尔语", "Nepali", "Devanagari", false},
	{"urd_Arab", "乌尔都语", "Urdu (Arabic script)", "Arabic", false},
	{"mkd_Cyrl", "马其顿语", "Macedonian", "Cyrillic", false},
	{"srp_Cyrl", "塞尔维亚语（西里尔）", "Serbian (Cyrillic)", "Cyrillic", false},
	{"mar_Deva", "马拉地语", "Marathi", "Devanagari", false},
	{"kat_Geor", "格鲁吉亚语", "Georgian", "Georgian", false},
	{"mal_Mlym", "马拉雅拉姆语", "Malayalam", "Malayalam", false},
	{"kaz_Cyrl", "哈萨克语", "Kazakh", "Cyrillic", false},
	{"isl_Latn", "冰岛语", "Icelandic", "Latin", false},
	{"glg_Latn", "加利西亚语", "Galician", "Latin", false},
	{"kan_Knda", "卡纳达语", "Kannada", "Kannada", false},
	{"ary_Arab", "摩洛哥阿拉伯语", "Moroccan Arabic", "Arabic", false},
	{"guj_Gujr", "古吉拉特语", "Gujarati", "Gujarati", false},
	{"bel_Cyrl", "白俄罗斯语", "Belarusian", "Cyrillic", false},
	{"afr_Latn", "南非荷兰语", "Afrikaans", "Latin", false},
	{"hye_Armn", "亚美尼亚语", "Armenian", "Armenian", false},
	{"khk_Cyrl", "蒙古语", "Mongolian", "Cyrillic", false},
	{"khm_Khmr", "高棉语", "Khmer", "Khmer", false},
	{"eus_Latn", "巴斯克语", "Basque", "Latin", false},
	{"mya_Mymr", "缅甸语", "Burmese", "Myanmar", false},
	{"lat_Latn", "拉丁语", "Latin", "Latin", false},
	{"uzn_Cyrl", "乌兹别克语（西里尔）", "Uzbek (Cyrillic)", "Cyrillic", false},
	{"tel_Telu", "泰卢固语", "Telugu", "Telugu", false},
	{"ory_Orya", "奥里亚语", "Odia", "Oriya", false},
	{"nno_Latn", "挪威尼诺斯克语", "Norwegian Nynorsk", "Latin", false},
	{"uzn_Latn", "乌兹别克语（拉丁）", "Uzbek (Latin)", "Latin", false},
	{"swh_Latn", "斯瓦希里语", "Swahili", "Latin", false},
	{"sin_Sinh", "僧伽罗语", "Sinhala", "Sinhala", false},
	{"kir_Cyrl", "吉尔吉斯语", "Kyrgyz", "Cyrillic", false},
	{"som_Latn", "索马里语", "Somali", "Latin", false},
	{"pan_Guru", "旁遮普语", "Punjabi", "Gurmukhi", false},
	{"arz_Arab", "埃及阿拉伯语", "Egyptian Arabic", "Arabic", false},
	{"cym_Latn", "威尔士语", "Welsh", "Latin", false},
	{"nrm_Latn", "诺曼语", "Norman", "Latin", false},
	{"pbt_Arab", "普什图语", "Pashto", "Arabic", false},
	{"gle_Latn", "爱尔兰语", "Irish", "Latin", false},
	{"srp_Latn", "塞尔维亚语（拉丁）", "Serbian (Latin)", "Latin", false},
	{"hau_Latn", "豪萨语", "Hausa", "Latin", false},
	{"ckb_Arab", "中库尔德语", "Central Kurdish", "Arabic", false},
	{"mlt_Latn", "马耳他语", "Maltese", "Latin", false},
	{"yue_Hani", "粤语", "Cantonese", "Han", false},
	{"yue_Hant", "粤语", "Cantonese", "Han", false},
	{"tgk_Cyrl", "塔吉克语", "Tajik", "Cyrillic", false},
	{"kmr_Latn", "北库尔德语", "Northern Kurdish", "Latin", false},
	{"bew_Latn", "贝塔维语", "Betawi", "Latin", false},
	{"amh_Ethi", "阿姆哈拉语", "Amharic", "Ethiopic", false},
	{"lao_Laoo", "老挝语", "Lao", "Lao", false},
	{"ltz_Latn", "卢森堡语", "Luxembourgish", "Latin", false},
	{"fry_Latn", "弗里西语", "Frisian", "Latin", false},
	{"div_Thaa", "迪维希语", "Dhivehi", "Thaana", false},
	{"epo_Latn", "世界语", "Esperanto", "Latin", false},
	{"kin_Latn", "基尼亚卢旺达语", "Kinyarwanda", "Latin", false},
	{"ars_Arab", "纳季迪阿拉伯语", "Najdi Arabic", "Arabic", false},
	{"fao_Latn", "法罗语", "Faroese", "Latin", false},
	{"plt_Latn", "马达加斯加语", "Malagasy", "Latin", false},
	{"asm_Beng", "阿萨姆语", "Assamese", "Bengali", false},
	{"snd_Arab", "信德语", "Sindhi", "Arabic", false},
	{"xho_Latn", "科萨语", "Xhosa", "Latin", false},
	{"tuk_Latn", "土库曼语", "Turkmen", "Latin", false},
	{"hat_Latn", "海地克里奥尔语", "Haitian Creole", "Latin", false},
	{"gla_Latn", "苏格兰盖尔语", "Scottish Gaelic", "Latin", false},
	{"ceb_Latn", "宿务语", "Cebuano", "Latin", false},
	{"ydd_Hebr", "意第绪语", "Yiddish", "Hebrew", false},
	{"jav_Latn", "爪哇语", "Javanese", "Latin", false},
	{"bak_Cyrl", "巴什基尔语", "Bashkir", "Cyrillic", false},
	{"pap_Latn", "帕皮阿门托语", "Papiamento", "Latin", false},
	{"mri_Latn", "毛利语", "Māori", "Latin", false},
	{"uig_Arab", "维吾尔语", "Uyghur", "Arabic", false},
	{"tat_Cyrl", "鞑靼语", "Tatar", "Cyrillic", false},
	{"bod_Tibt", "藏语", "Tibetan", "Tibetan", false},
	{"mww_Latn", "白苗语", "White Hmong", "Latin", false},
	{"hyw_Armn", "西亚美尼亚语", "Western Armenian", "Armenian", false},
	{"yor_Latn", "约鲁巴语", "Yoruba", "Latin", false},
	{"zul_Latn", "祖鲁语", "Zulu", "Latin", false},
	{"sdh_Arab", "南库尔德语", "Southern Kurdish", "Arabic", false},
	{"smo_Latn", "萨摩亚语", "Samoan", "Latin", false},
	{"cos_Latn", "科西嘉语", "Corsican", "Latin", false},
	{"hif_Latn", "斐济印地语", "Fiji Hindi", "Latin", false},
	{"sun_Latn", "巽他语", "Sundanese", "Latin", false},
	{"nya_Latn", "齐切瓦语", "Chichewa", "Latin", false},
	{"ibo_Latn", "伊博语", "Igbo", "Latin", false},
	{"haw_Latn", "夏威夷语", "Hawaiian", "Latin", false},
	{"sot_Latn", "塞索托语", "Sesotho", "Latin", false},
	{"lus_Latn", "米佐语", "Mizo", "Latin", false},
	{"sna_Latn", "绍纳语", "Shona", "Latin", false},
	{"chv_Cyrl", "楚瓦什语", "Chuvash", "Cyrillic", false},
	{"azb_Arab", "南阿塞拜疆语", "South Azerbaijani", "Arabic", false},
	{"roh_Latn", "罗曼什语", "Romansh", "Latin", false},
	{"run_Latn", "基隆迪语", "Kirundi", "Latin", false},
	{"hin_Latn", "印地语（拉丁）", "Hindi (Latin)", "Latin", false},
	{"sah_Cyrl", "雅库特语", "Yakut", "Cyrillic", false},
	{"tir_Ethi", "提格里尼亚语", "Tigrinya", "Ethiopic", false},
	{"ast_Latn", "阿斯图里亚斯语", "Asturian", "Latin", false},
	{"oci_Latn", "奥克语", "Occitan", "Latin", false},
	{"cnh_Latn", "钦邦语（Hakha Chin）", "Hakha Chin", "Latin", false},
	{"sme_Latn", "北萨米语", "Northern Sami", "Latin", false},
	{"nds_Latn", "低地德语", "Low German", "Latin", false},
	{"oss_Cyrl", "奥塞梯语", "Ossetian", "Cyrillic", false},
	{"urd_Latn", "乌尔都语（拉丁）", "Urdu (Latin)", "Latin", false},
	{"gsw_Latn", "瑞士德语", "Swiss German", "Latin", false},
	{"anp_Deva", "昂加语", "Angika", "Devanagari", false},
	{"apc_Arab", "黎凡特阿拉伯语", "Levantine Arabic", "Arabic", false},
	{"gaz_Latn", "奥罗莫语", "Oromo", "Latin", false},
	{"nap_Latn", "那不勒斯语", "Neapolitan", "Latin", false},
	{"hsb_Latn", "上索布语", "Upper Sorbian", "Latin", false},
	{"hil_Latn", "希利盖农语", "Hiligaynon", "Latin", false},
	{"kal_Latn", "格陵兰语", "Greenlandic", "Latin", false},
}

// LangByCode 查询语言。
func LangByCode(code string) (Lang, bool) {
	for _, l := range Languages {
		if l.Code == code {
			return l, true
		}
	}
	return Lang{}, false
}

// LangName prompt 用的中文名（官方 LANG_NAMES.get(code, code) 语义）。
func LangName(code string) string {
	if l, ok := LangByCode(code); ok {
		return l.ZhName
	}
	return code
}
