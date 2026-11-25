"""CASE — workflow engine API (FastAPI).

The Python service that replaces the Node/Express server in
``template-module/server``. It speaks the same HTTP contract (see
``dashboard/src/api/client.ts``), so the React dashboard does not change when the
proxy target changes.
"""

__all__ = ["__version__"]

__version__ = "1.0.0"
