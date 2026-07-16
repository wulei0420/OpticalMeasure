"""底痤层 — 配置管理、路由工厂、模块间通信"""
import threading

_state = {}
_lock = threading.Lock()

def set_state(key, value):
    with _lock:
        _state[key] = value

def get_state(key, default=None):
    with _lock:
        return _state.get(key, default)

def clear_state(key=None):
    with _lock:
        if key is None:
            _state.clear()
        else:
            _state.pop(key, None)
