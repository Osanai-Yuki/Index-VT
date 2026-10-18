# 翻译预设对照评估

本次增加“通用增强”，为其及四个领域预设加入语义底线、按需括注及准确性优先规则。保留“通用翻译”的官方默认提示词，默认选项仍为“通用翻译”。优先级规则由预设通过现有硬约束字段传递，不修改后端官方提示词构造器，也不自动注入用户自定义模式。

## 对照方法

固定模型、量化版本、源/目标语言、上下文长度、采样参数和术语本。每次使用完整原文，分别运行“通用翻译”“通用增强”和对应领域预设，保留实际输出。下表的检查点用于人工评估语义，不要求译文逐字匹配参考措辞。

| 编号 | 原文（英语译为中文） | 重点检查 | 对应领域 |
| --- | --- | --- | --- |
| 1 | More likely, the prediction of greatness was fabricated once greatness was achieved or within reach. | 保留“更有可能”的推测；within reach 表示已可企及，不泛化为所有“实现之前”。 | 人文写作 |
| 2 | When he disclosed the time of his birth, the astrologer flung himself at his feet, giving his patron a boost in confidence. | time 不缩窄为“日期”；保留占星家与其庇护者的关系；不擅自解释该关系。 | 人文写作 |
| 3 | The prediction would have been all the more impressive given his obscurity at the time. | 保留推测和比较强度；不夸张为“神乎其神”，不偏移为受关注程度。 | 人文写作 |
| 4 | Not all participants who received the notice attended the meeting. | 否定范围是“并非所有人都出席”，不是“所有人都未出席”。 | 通用增强 |
| 5 | The plan could proceed only if funding was approved; approval alone would not guarantee success. | 保留必要条件、可能性和“仅有批准不足以保证成功”。 | 政治经济·社科金融 |
| 6 | The minister called the proposal reckless. The ABC group reported a 2.75% decline. | “鲁莽”的评价归属于部长，不能改成译者判断；不猜测 ABC 全称；数字不变。 | 政治经济·社科金融 |
| 7 | The transformer architecture is implemented in PyTorch. Run `python train.py --lr 0.001` and save to `runs/model-v2.pt`. | 区分技术概念和产品名称；代码、参数、数值、路径逐字保留；自然语言按语境翻译。 | 计算机·人工智能 |
| 8 | “A fine mess,” she said, laughing. | 保留反讽及笑着说的动作；不机械地把 fine 译为正面赞美，不添加原文没有的意象。 | 人文写作 |
| 9 | In this small observational study, Drug Z was associated with lower symptom scores; causation has not been established. | 保留样本与研究类型限定、关联及因果未确立；不推断 Drug Z 的通用名或商品身份。 | 医疗生物 |
| 10 | If the flag is not set, retry at most twice; do not retry after a successful response. | 保留否定、条件、“最多两次”和成功后禁止重试的范围。 | 计算机·人工智能 |

## 记录方式

每项分别标记：漏译、增译、逻辑偏移、语气偏移、术语/格式问题，以及中文是否自然。语义错误优先于文风偏好，不以措辞更华丽作为更好的依据。第 7 项还应反向译为英语，确认中文混排规则不会要求修改英文排版或代码。

本文件提供评估材料，不代表已完成模型质量评估。构建成功和提示词生成检查只能验证程序接线，不能证明模型一定遵循约束。
