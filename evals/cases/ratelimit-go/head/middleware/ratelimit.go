package middleware

import (
	"net/http"
	"sync"
	"time"

	"example.com/api/config"
)

type bucket struct {
	tokens float64
	last   time.Time
}

type Limiter struct {
	mu      sync.Mutex
	cfg     config.Config
	buckets map[string]*bucket
}

func NewLimiter(cfg config.Config) *Limiter {
	return &Limiter{cfg: cfg, buckets: map[string]*bucket{}}
}

func keyFor(r *http.Request) string {
	if k := r.Header.Get("X-API-Key"); k != "" {
		return "key:" + k
	}
	return "ip:" + r.RemoteAddr
}

func (l *Limiter) Allow(r *http.Request) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	capacity := float64(l.cfg.RequestsPerMinute + l.cfg.Burst)
	b, ok := l.buckets[keyFor(r)]
	if !ok {
		b = &bucket{tokens: capacity, last: time.Now()}
		l.buckets[keyFor(r)] = b
	}
	rate := float64(l.cfg.RequestsPerMinute) / 60
	b.tokens = min(capacity, b.tokens+time.Since(b.last).Seconds()*rate)
	b.last = time.Now()
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
