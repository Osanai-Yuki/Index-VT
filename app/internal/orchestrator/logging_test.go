package orchestrator

import (
	"os"
	"testing"
)

type loggingSettings struct {
	stubSettings
	enabled bool
}

func (s loggingSettings) LoggingEnabled() bool { return s.enabled }

func TestInferenceLogDestination(t *testing.T) {
	for _, settings := range []Settings{stubSettings{}, loggingSettings{enabled: false}} {
		if got := inferenceLogPath(settings); got != os.DevNull {
			t.Fatalf("关闭日志时引擎输出必须丢弃，得到 %q", got)
		}
	}
	if got := inferenceLogPath(loggingSettings{enabled: true}); got != llamaLogPath() {
		t.Fatalf("开启日志时输出位置错误: %q", got)
	}
}
