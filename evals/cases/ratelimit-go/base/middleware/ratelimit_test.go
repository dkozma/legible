package middleware

import (
	"net/http/httptest"
	"testing"

	"example.com/api/config"
)

func TestLimitsPerMinute(t *testing.T) {
	l := NewLimiter(config.Config{RequestsPerMinute: 1})
	r := httptest.NewRequest("GET", "/", nil)
	if !l.Allow(r) || l.Allow(r) {
		t.Fatal("want one request per minute")
	}
}
