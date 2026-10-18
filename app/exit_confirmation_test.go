package main

import (
	"context"
	"errors"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func TestExitConfirmationNativeResponses(t *testing.T) {
	broken := errors.New("dialog failed")
	for _, tc := range []struct {
		name     string
		response string
		err      error
		want     bool
	}{
		{"Windows yes exits", "Yes", nil, true},
		{"Windows no returns", "No", nil, false},
		{"dismissed returns", "", nil, false},
		{"unexpected response returns", "Ok", nil, false},
		{"dialog failure returns", "Yes", broken, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ready := make(chan struct{})
			close(ready)
			a := &App{ready: ready, workspace: map[string]bool{"translate": true}}
			calls := 0
			got, err := a.confirmExit(func(_ context.Context, options runtime.MessageDialogOptions) (string, error) {
				calls++
				if options.Type != runtime.QuestionDialog || options.DefaultButton != "No" || options.CancelButton != "No" {
					t.Fatalf("退出确认必须使用原生问题框并默认不退出: %+v", options)
				}
				return tc.response, tc.err
			})
			if got != tc.want || !errors.Is(err, tc.err) || calls != 1 {
				t.Fatalf("确认结果=%v, err=%v, calls=%d", got, err, calls)
			}
			if a.closing {
				t.Fatal("仅确认不应提前释放资源，取消后应能继续操作")
			}
		})
	}
}

func TestExitConfirmationDoesNotRepeatWhenClosingOrClean(t *testing.T) {
	for _, tc := range []struct{ closing, dirty bool }{{false, false}, {true, true}} {
		ready := make(chan struct{})
		close(ready)
		a := &App{ready: ready, closing: tc.closing, workspace: map[string]bool{"translate": tc.dirty}}
		confirmed, err := a.confirmExit(func(context.Context, runtime.MessageDialogOptions) (string, error) {
			t.Fatal("无草稿或正在退出时不应再次弹出确认")
			return "", nil
		})
		if !confirmed || err != nil {
			t.Fatalf("不应阻止退出: %v, %v", confirmed, err)
		}
	}
}
