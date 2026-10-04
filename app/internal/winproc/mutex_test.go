package winproc

import "testing"

// 正常路径：第二次调用必须报"已有实例"，而不是 error。
func TestTryCreateMutexSecondCallReportsAlreadyRunning(t *testing.T) {
	name := `Local\IndexVT-MutexTest-` + t.Name()
	h1, acquired, err := TryCreateMutex(name)
	if err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("首次创建应获得实例权")
	}
	defer ReleaseMutex(h1)

	h2, acquired2, err2 := TryCreateMutex(name)
	if err2 != nil {
		t.Fatalf("第二次调用应是 alreadyRunning 而非错误: %v", err2)
	}
	if acquired2 {
		t.Fatal("第二次调用 acquired 必须为 false")
	}
	ReleaseMutex(h2)
}
