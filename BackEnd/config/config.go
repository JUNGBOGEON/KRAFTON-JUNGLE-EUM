package config

import (
	"os"
)

type Config struct {
	LiveKitHost      string
	LiveKitAPIKey    string
	LiveKitAPISecret string
	Port             string
}

func Load() *Config {
	return &Config{
		LiveKitHost:      getEnv("LIVEKIT_HOST", "ws://localhost:7880"),
		LiveKitAPIKey:    getEnv("LIVEKIT_API_KEY", "devkey"),
		LiveKitAPISecret: getEnv("LIVEKIT_API_SECRET", "secret"),
		Port:             getEnv("PORT", "8080"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
