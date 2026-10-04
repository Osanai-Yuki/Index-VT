// Go error → 类型化 AppError（计划 Task 2.3 / spec §5）
// ------------------------------------------------------------
// Wails v2 会把 Go 绑定返回的 error 以**格式化后的消息字符串** reject 给前端——
// %w 包装链在这里不存在，只能按消息特征分类。因此**匹配词全部取自后端真实文案**，
// 来源：grep -rn "fmt.Errorf|errors.New" app/（2026-10-05，Track A 后的 master）。
// 关键锚点：
//   app/internal/translator/translator.go:46  ErrCanceled = errors.New("已取消")
//   app/internal/translator/translator.go:49  ErrFirstTokenTimeout = errors.New("模型未在预期时间内返回首字")
//   app/app.go:56                             ensureReady 超时 "应用服务装配超时，请重启"
//   app/app.go                                绑定门禁 "翻译服务不可用"
// 后端改文案时必须同步本文件（verify-lib/wails 不校验这条——靠 review 纪律）。

export type AppErrorKind =
  | 'not-ready'
  | 'validation'
  | 'io'
  | 'network'
  | 'model'
  | 'canceled'
  | 'timeout'
  | 'unknown'

export interface AppError {
  kind: AppErrorKind
  message: string
  retryable: boolean
  /** 指向「打开日志文件夹」（后端 OpenLogsFolder 绑定）的提示文案 */
  logHint?: string
}

/* 分类规则：**顺序即优先级**，首条命中即停。
   - canceled 最先（否则「已取消」会掉进其它桶）；
   - model 先于 validation（"llama-server.exe 不存在" 是模型进程问题，不是用户输入问题）；
   - validation 先于 io（"该模型已有下载任务进行中" 是操作冲突，不是下载 IO 故障）。 */
const RULES: ReadonlyArray<{
  kind: AppErrorKind
  re: RegExp
  retryable: boolean
}> = [
  { kind: 'canceled', re: /已取消/, retryable: false },
  { kind: 'not-ready', re: /装配超时|翻译服务不可用|Wails runtime 不可用/, retryable: true },
  { kind: 'timeout', re: /首字/, retryable: true },
  {
    kind: 'model',
    re: /llama|推理请求失败|推理响应数据异常|无 choices|模型释放超时|启动参数非法/,
    retryable: true,
  },
  {
    kind: 'validation',
    re: /不存在|不支持|校验失败|非法|为空|越界|白名单|未知|无进行中|没有失败条目|已在|正在下载|进行中|超长|占位符|必须|不得|不支持|拒绝|异常.*格式|格式异常/,
    retryable: false,
  },
  {
    kind: 'network',
    re: /源不可达|双源均不可达|重定向|拒绝连接|域名解析|HTTP \d|网络|超时/,
    retryable: true,
  },
  {
    kind: 'io',
    re: /SHA256|下载|重命名|文件过大|文件名|路径|数据库|sqlite|写入|读取/i,
    retryable: true,
  },
]

export function toAppError(e: unknown): AppError {
  /* 已是 AppError（callApp 二次包装防护）→ 原样返回 */
  if (typeof e === 'object' && e !== null && 'kind' in e && 'message' in e) {
    return e as AppError
  }

  let message: string
  if (e instanceof Error) message = e.message
  else if (typeof e === 'string') message = e
  else if (typeof e === 'object' && e !== null && 'message' in e) message = String((e as { message: unknown }).message)
  else message = String(e)

  if (!message.trim()) {
    return { kind: 'unknown', message: '未知错误（无错误消息）', retryable: false, logHint: LOG_HINT }
  }

  for (const rule of RULES) {
    if (rule.re.test(message)) {
      return { kind: rule.kind, message, retryable: rule.retryable, logHint: LOG_HINT }
    }
  }
  return { kind: 'unknown', message, retryable: false, logHint: LOG_HINT }
}

const LOG_HINT = '详情见应用日志（设置 → 打开日志文件夹）'

/** 取消不是错误（spec §5 规则 1）：UI 收到 canceled 应静默退出流程，不弹错误。 */
export function isCancel(e: unknown): boolean {
  return toAppError(e).kind === 'canceled'
}
