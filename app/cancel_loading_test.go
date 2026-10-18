package main

import (
	"context"
	"testing"
)

func TestCancelTaskWorksBeforeTranslatorRegistration(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a := &App{ready: make(chan struct{}), taskCancels: map[string]context.CancelFunc{"loading": cancel}}
	close(a.ready)
	if err := a.CancelTask("loading"); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() != context.Canceled {
		t.Fatal("loading task was not canceled")
	}
}
