"""
Async Loop Manager for handling asyncio in threaded gRPC context
"""

import asyncio
import threading


class AsyncLoopManager:
    """
    전용 asyncio 이벤트 루프 관리자

    별도 스레드에서 이벤트 루프를 실행하여 asyncio.run() 블로킹 문제 해결
    """
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def initialize(self):
        if self._initialized:
            return

        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        self._initialized = True

    def _run_loop(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def run_async(self, coro, timeout: float = 30.0):
        """
        비동기 코루틴을 실행하고 결과를 반환

        Args:
            coro: 실행할 코루틴
            timeout: 타임아웃 (초)

        Returns:
            코루틴 결과
        """
        future = asyncio.run_coroutine_threadsafe(coro, self.loop)
        try:
            return future.result(timeout=timeout)
        except asyncio.TimeoutError:
            future.cancel()
            raise TimeoutError(f"Async operation timed out after {timeout}s")
        except Exception as e:
            raise e

    def shutdown(self):
        if self._initialized and self.loop.is_running():
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(timeout=5)
