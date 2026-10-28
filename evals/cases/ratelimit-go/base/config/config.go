package config

import "time"

type Config struct {
	RequestsPerMinute int
	Timeout           time.Duration
}

func Default() Config {
	return Config{
		RequestsPerMinute: 60,
		Timeout:           30 * time.Second,
	}
}
