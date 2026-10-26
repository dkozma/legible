package middleware

import (
	"net/http/httptest"
	"testing"

	"example.com/api/config"
)

func TestAllowsABurst(t *testing.T) {
	l := NewLimiter(config.Config{RequestsPerMinute: 1, Burst: 2})
	r := httptest.NewRequest("GET", "/", nil)
	for i := 0; i < 3; i++ {
		if !l.Allow(r) {
			t.Fatalf("request %d refused inside the burst", i)
		}
	}
	if l.Allow(r) {
		t.Fatal("want the fourth request refused")
	}
}

func TestLimitsPerKey(t *testing.T) {
	l := NewLimiter(config.Config{RequestsPerMinute: 1})
	a := httptest.NewRequest("GET", "/", nil)
	a.Header.Set("X-API-Key", "a")
	b := httptest.NewRequest("GET", "/", nil)
	b.Header.Set("X-API-Key", "b")
	if !l.Allow(a) || !l.Allow(b) {
		t.Fatal("want separate limits per key")
	}
}
