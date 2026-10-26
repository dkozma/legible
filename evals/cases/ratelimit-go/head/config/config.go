package config

import "time"

type Config struct {
	RequestsPerMinute int
	Burst             int
	Timeout           time.Duration
}

func Default() Config {
	return Config{
		RequestsPerMinute: 60,
		Burst:             10,
		Timeout:           10 * time.Second,
	}
}
