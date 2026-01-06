package aws

import (
	"errors"
	"sync"
	"time"
)

// Circuit Breaker States
const (
	StateClosed   = "closed"
	StateOpen     = "open"
	StateHalfOpen = "half-open"
)

// Circuit Breaker Errors
var (
	ErrCircuitOpen     = errors.New("circuit breaker is open")
	ErrTooManyRequests = errors.New("too many requests in half-open state")
)

// CircuitBreaker implements the circuit breaker pattern for AWS service calls
type CircuitBreaker struct {
	name             string
	state            string
	failureCount     int
	successCount     int
	failureThreshold int           // failures before opening
	successThreshold int           // successes in half-open before closing
	cooldownPeriod   time.Duration // time to wait before half-open
	openTime         time.Time
	halfOpenRequests int
	maxHalfOpen      int // max concurrent requests in half-open
	mu               sync.RWMutex

	// Metrics
	totalRequests   int64
	totalFailures   int64
	totalSuccesses  int64
	lastFailureTime time.Time
	lastSuccessTime time.Time
}

// CircuitBreakerConfig configuration for circuit breaker
type CircuitBreakerConfig struct {
	Name             string
	FailureThreshold int
	SuccessThreshold int
	CooldownPeriod   time.Duration
	MaxHalfOpen      int
}

// DefaultCircuitBreakerConfig returns default configuration
func DefaultCircuitBreakerConfig(name string) *CircuitBreakerConfig {
	return &CircuitBreakerConfig{
		Name:             name,
		FailureThreshold: 5,
		SuccessThreshold: 3,
		CooldownPeriod:   30 * time.Second,
		MaxHalfOpen:      1,
	}
}

// NewCircuitBreaker creates a new circuit breaker
func NewCircuitBreaker(cfg *CircuitBreakerConfig) *CircuitBreaker {
	if cfg == nil {
		cfg = DefaultCircuitBreakerConfig("default")
	}

	return &CircuitBreaker{
		name:             cfg.Name,
		state:            StateClosed,
		failureThreshold: cfg.FailureThreshold,
		successThreshold: cfg.SuccessThreshold,
		cooldownPeriod:   cfg.CooldownPeriod,
		maxHalfOpen:      cfg.MaxHalfOpen,
	}
}

// Execute runs the given function with circuit breaker protection
func (cb *CircuitBreaker) Execute(fn func() error) error {
	// Check and acquire request slot atomically
	cb.mu.Lock()
	allowed := cb.allowRequestLocked()
	if !allowed {
		cb.mu.Unlock()
		return ErrCircuitOpen
	}

	cb.totalRequests++
	wasHalfOpen := cb.state == StateHalfOpen
	if wasHalfOpen {
		cb.halfOpenRequests++
	}
	cb.mu.Unlock()

	// Execute the function (outside lock)
	err := fn()

	// Record result
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if wasHalfOpen && cb.state == StateHalfOpen {
		cb.halfOpenRequests--
	}

	if err != nil {
		cb.recordFailure()
		return err
	}

	cb.recordSuccess()
	return nil
}

// allowRequestLocked checks if a request is allowed (must be called with lock held)
func (cb *CircuitBreaker) allowRequestLocked() bool {
	switch cb.state {
	case StateClosed:
		return true

	case StateOpen:
		// Check if cooldown period has passed
		if time.Since(cb.openTime) > cb.cooldownPeriod {
			cb.state = StateHalfOpen
			cb.halfOpenRequests = 0
			cb.successCount = 0
			return true
		}
		return false

	case StateHalfOpen:
		// Limit concurrent requests in half-open state
		return cb.halfOpenRequests < cb.maxHalfOpen

	default:
		return true
	}
}

// allowRequest checks if a request is allowed (public wrapper)
func (cb *CircuitBreaker) allowRequest() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.allowRequestLocked()
}

// recordFailure records a failure
func (cb *CircuitBreaker) recordFailure() {
	cb.totalFailures++
	cb.failureCount++
	cb.successCount = 0
	cb.lastFailureTime = time.Now()

	switch cb.state {
	case StateClosed:
		if cb.failureCount >= cb.failureThreshold {
			cb.tripBreaker()
		}

	case StateHalfOpen:
		// Any failure in half-open state trips the breaker
		cb.tripBreaker()
	}
}

// recordSuccess records a success
func (cb *CircuitBreaker) recordSuccess() {
	cb.totalSuccesses++
	cb.successCount++
	cb.lastSuccessTime = time.Now()

	switch cb.state {
	case StateClosed:
		cb.failureCount = 0

	case StateHalfOpen:
		if cb.successCount >= cb.successThreshold {
			cb.reset()
		}
	}
}

// tripBreaker opens the circuit breaker
func (cb *CircuitBreaker) tripBreaker() {
	cb.state = StateOpen
	cb.openTime = time.Now()
	cb.failureCount = 0
	cb.successCount = 0
}

// reset closes the circuit breaker
func (cb *CircuitBreaker) reset() {
	cb.state = StateClosed
	cb.failureCount = 0
	cb.successCount = 0
}

// State returns the current state
func (cb *CircuitBreaker) State() string {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.state
}

// Stats returns circuit breaker statistics
func (cb *CircuitBreaker) Stats() map[string]interface{} {
	cb.mu.RLock()
	defer cb.mu.RUnlock()

	return map[string]interface{}{
		"name":            cb.name,
		"state":           cb.state,
		"totalRequests":   cb.totalRequests,
		"totalFailures":   cb.totalFailures,
		"totalSuccesses":  cb.totalSuccesses,
		"failureCount":    cb.failureCount,
		"successCount":    cb.successCount,
		"lastFailureTime": cb.lastFailureTime,
		"lastSuccessTime": cb.lastSuccessTime,
	}
}

// ForceOpen forces the circuit breaker to open state (for testing/emergency)
func (cb *CircuitBreaker) ForceOpen() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.tripBreaker()
}

// ForceClose forces the circuit breaker to closed state (for testing/emergency)
func (cb *CircuitBreaker) ForceClose() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.reset()
}
