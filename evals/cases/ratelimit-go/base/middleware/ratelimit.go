package middleware

import (
	"net/http"
	"sync"
	"time"

	"example.com/api/config"
)

type Limiter struct {
	mu     sync.Mutex
	cfg    config.Config
	counts map[string]int
	window time.Time
}

func NewLimiter(cfg config.Config) *Limiter {
	return &Limiter{cfg: cfg, counts: map[string]int{}, window: time.Now()}
}

func (l *Limiter) Allow(r *http.Request) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if time.Since(l.window) > time.Minute {
		l.counts = map[string]int{}
		l.window = time.Now()
	}
	key := r.RemoteAddr
	l.counts[key]++
	return l.counts[key] <= l.cfg.RequestsPerMinute
}
