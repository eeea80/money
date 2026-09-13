"""Script source library service.

Script sources are reusable code assets. Runtime/live strategies reference a
source by id and keep market, account, notification, and risk settings in
``qd_strategies_trading``.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, List, Optional

from app.utils.db import get_db_connection
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _json_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {}


def _json_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return list(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            pass
    return []


def _json_dump(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value if isinstance(value, dict) else {}, ensure_ascii=False)


def _json_dump_any(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def _source_asset_type(value: Any) -> str:
    normalized = str(value or "script").strip().lower()
    if normalized in {"portfolio", "cross_section", "cross-section"}:
        normalized = "portfolio_strategy"
    if normalized not in {"script", "portfolio_strategy"}:
        raise ValueError("strategy.invalidAssetType")
    return normalized


def _ensure_script_metadata_header(code: str, title: str, description: str) -> str:
    source = str(code or "")
    clean_title = str(title or "").strip()
    clean_description = str(description or "").strip()
    if not source.strip() or not clean_title:
        return source

    doc_match = re.match(r"\s*(\"\"\"|''')([\s\S]*?)\1", source)
    if not doc_match:
        body = clean_title
        if clean_description:
            body += "\n" + clean_description
        return f'"""\n{body}\n"""\n\n{source.lstrip()}'

    quote = doc_match.group(1)
    doc_body = str(doc_match.group(2) or "")
    lines = [str(line or "").rstrip() for line in doc_body.splitlines()]
    first_idx = next((idx for idx, line in enumerate(lines) if line.strip()), -1)
    if first_idx < 0:
        lines = [clean_title]
        if clean_description:
            lines.append(clean_description)
    else:
        lines[first_idx] = clean_title
        has_description = any(line.strip() for line in lines[first_idx + 1:])
        if clean_description and not has_description:
            lines.insert(first_idx + 1, clean_description)

    next_doc = f"{quote}\n" + "\n".join(lines).strip() + f"\n{quote}"
    return next_doc + source[doc_match.end():]



class ScriptSourceService:
    """CRUD and delivery helpers for script strategy source code."""

    def _insert_version(
        self,
        cur,
        source_id: int,
        user_id: int,
        name: str,
        description: str,
        code: str,
        template_key: str,
        param_schema: Any,
        metadata: Any,
    ) -> int:
        cur.execute(
            """
            SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version
            FROM qd_script_source_versions
            WHERE source_id = ? AND user_id = ?
            """,
            (int(source_id), int(user_id)),
        )
        row = cur.fetchone() or {}
        version_no = int(row.get("next_version") or 1)
        cur.execute(
            """
            INSERT INTO qd_script_source_versions
              (source_id, user_id, version_no, name, description, code,
               template_key, param_schema, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, NOW())
            """,
            (
                int(source_id),
                int(user_id),
                version_no,
                name or "",
                description or "",
                code or "",
                template_key or "",
                _json_dump(param_schema),
                _json_dump(metadata),
            ),
        )
        return version_no

    def _row(self, row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not row:
            return None
        item = dict(row)
        item["param_schema"] = _json_dict(item.get("param_schema"))
        item["metadata"] = _json_dict(item.get("metadata"))
        return item

    def _version_row(self, row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not row:
            return None
        item = dict(row)
        if "param_schema" in item:
            item["param_schema"] = _json_dict(item.get("param_schema"))
        if "metadata" in item:
            item["metadata"] = _json_dict(item.get("metadata"))
        return item

    def _template_row(self, row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not row:
            return None
        item = dict(row)
        item["asset_type"] = _source_asset_type(item.get("asset_type"))
        item["param_schema"] = _json_dict(item.get("param_schema"))
        item["params"] = _json_list(item["param_schema"].get("params"))
        item["tags"] = _json_list(item.get("tags"))
        item["metadata"] = _json_dict(item.get("metadata"))
        item["key"] = item.get("template_key") or ""
        item["desc"] = item.get("description") or ""
        item["code"] = _ensure_script_metadata_header(
            item.get("code") or "",
            item.get("title") or item["key"],
            item.get("description") or "",
        )
        return item

    def list_templates(self) -> List[Dict[str, Any]]:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT id, template_key, asset_type, title, description, code, param_schema, tags,
                       icon, accent, sort_order, is_active, metadata, created_at, updated_at
                FROM qd_script_templates
                WHERE is_active = TRUE
                ORDER BY sort_order ASC, id ASC
                """
            )
            rows = cur.fetchall() or []
            cur.close()
        return [self._template_row(row) for row in rows if row]

    def list_sources(self, user_id: int) -> List[Dict[str, Any]]:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT id, user_id, name, description, code, asset_type, template_key, param_schema,
                       source_marketplace_indicator_id, source_script_source_id,
                       visibility, status, metadata, created_at, updated_at
                FROM qd_script_sources
                WHERE user_id = ?
                ORDER BY updated_at DESC, id DESC
                """,
                (int(user_id),),
            )
            rows = cur.fetchall()
            cur.close()
        return [self._row(row) for row in rows if row]

    def get_source(self, source_id: int, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with get_db_connection() as db:
            cur = db.cursor()
            if user_id is None:
                cur.execute(
                    """
                    SELECT id, user_id, name, description, code, asset_type, template_key, param_schema,
                           source_marketplace_indicator_id, source_script_source_id,
                           visibility, status, metadata, created_at, updated_at
                    FROM qd_script_sources
                    WHERE id = ?
                    """,
                    (int(source_id),),
                )
            else:
                cur.execute(
                    """
                    SELECT id, user_id, name, description, code, asset_type, template_key, param_schema,
                           source_marketplace_indicator_id, source_script_source_id,
                           visibility, status, metadata, created_at, updated_at
                    FROM qd_script_sources
                    WHERE id = ? AND user_id = ?
                    """,
                    (int(source_id), int(user_id)),
                )
            row = cur.fetchone()
            cur.close()
        return self._row(row)

    def create_source(self, payload: Dict[str, Any]) -> int:
        user_id = int(payload.get("user_id") or 1)
        name = str(payload.get("name") or payload.get("strategy_name") or "Untitled Script").strip() or "Untitled Script"
        code = str(payload.get("code") or "")
        description = str(payload.get("description") or "")
        template_key = str(payload.get("template_key") or payload.get("templateKey") or "")
        param_schema = payload.get("param_schema") or payload.get("paramSchema") or {}
        metadata = payload.get("metadata") or {}
        asset_type = _source_asset_type(payload.get("asset_type") or payload.get("assetType"))
        source_marketplace_indicator_id = payload.get("source_marketplace_indicator_id") or payload.get("sourceMarketplaceIndicatorId")
        source_script_source_id = payload.get("source_script_source_id")

        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                INSERT INTO qd_script_sources
                  (user_id, name, description, code, asset_type, template_key, param_schema,
                   source_marketplace_indicator_id, source_script_source_id,
                   visibility, status, metadata, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?::jsonb, NOW(), NOW())
                """,
                (
                    user_id,
                    name,
                    description,
                    code,
                    asset_type,
                    template_key,
                    _json_dump(param_schema),
                    int(source_marketplace_indicator_id) if source_marketplace_indicator_id else None,
                    int(source_script_source_id) if source_script_source_id else None,
                    str(payload.get("visibility") or "private"),
                    str(payload.get("status") or "draft"),
                    _json_dump(metadata),
                ),
            )
            new_id = int(cur.lastrowid or 0)
            self._insert_version(
                cur,
                new_id,
                user_id,
                name,
                description,
                code,
                template_key,
                param_schema,
                metadata,
            )
            db.commit()
            cur.close()
        return new_id

    def update_source(self, source_id: int, user_id: int, payload: Dict[str, Any]) -> bool:
        existing = self.get_source(source_id, user_id=user_id)
        if not existing:
            return False
        name = str(payload.get("name") or payload.get("strategy_name") or existing.get("name") or "Untitled Script").strip()
        code = str(payload.get("code") if payload.get("code") is not None else existing.get("code") or "")
        description = str(payload.get("description") if payload.get("description") is not None else existing.get("description") or "")
        template_key = str(payload.get("template_key") or payload.get("templateKey") or existing.get("template_key") or "")
        param_schema = payload.get("param_schema") if "param_schema" in payload else payload.get("paramSchema", existing.get("param_schema") or {})
        metadata = payload.get("metadata") if "metadata" in payload else existing.get("metadata") or {}
        asset_type = _source_asset_type(
            payload.get("asset_type") if "asset_type" in payload
            else payload.get("assetType", existing.get("asset_type") or "script")
        )

        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                UPDATE qd_script_sources
                SET name = ?, description = ?, code = ?, asset_type = ?, template_key = ?,
                    param_schema = ?::jsonb, metadata = ?::jsonb, updated_at = NOW()
                WHERE id = ? AND user_id = ?
                """,
                (
                    name,
                    description,
                    code,
                    asset_type,
                    template_key,
                    _json_dump(param_schema),
                    _json_dump(metadata),
                    int(source_id),
                    int(user_id),
                ),
            )
            ok = cur.rowcount > 0
            if ok:
                self._insert_version(
                    cur,
                    source_id,
                    user_id,
                    name,
                    description,
                    code,
                    template_key,
                    param_schema,
                    metadata,
                )
            db.commit()
            cur.close()
        return ok

    def list_versions(self, source_id: int, user_id: int) -> tuple[bool, List[Dict[str, Any]]]:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute("SELECT id FROM qd_script_sources WHERE id = ? AND user_id = ?", (int(source_id), int(user_id)))
            if not cur.fetchone():
                cur.close()
                return False, []
            cur.execute(
                """
                SELECT id, source_id, user_id, version_no, name, description, template_key, created_at
                FROM qd_script_source_versions
                WHERE source_id = ? AND user_id = ?
                ORDER BY version_no DESC
                LIMIT 100
                """,
                (int(source_id), int(user_id)),
            )
            rows = cur.fetchall() or []
            db.commit()
            cur.close()
        return True, [self._version_row(row) for row in rows if row]

    def get_version(self, version_id: int, user_id: int) -> Optional[Dict[str, Any]]:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT id, source_id, user_id, version_no, name, description, code,
                       template_key, param_schema, metadata, created_at
                FROM qd_script_source_versions
                WHERE id = ? AND user_id = ?
                """,
                (int(version_id), int(user_id)),
            )
            row = cur.fetchone()
            db.commit()
            cur.close()
        return self._version_row(row)

    def restore_version(self, version_id: int, user_id: int) -> Optional[Dict[str, Any]]:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT v.source_id, v.name, v.description, v.code, v.template_key,
                       v.param_schema, v.metadata
                FROM qd_script_source_versions v
                JOIN qd_script_sources s ON s.id = v.source_id
                WHERE v.id = ? AND v.user_id = ? AND s.user_id = ?
                """,
                (int(version_id), int(user_id), int(user_id)),
            )
            row = self._version_row(cur.fetchone())
            if not row:
                cur.close()
                return None

            source_id = int(row.get("source_id") or 0)
            name = row.get("name") or "Untitled Script"
            description = row.get("description") or ""
            code = row.get("code") or ""
            template_key = row.get("template_key") or ""
            param_schema = row.get("param_schema") or {}
            metadata = row.get("metadata") or {}
            cur.execute(
                """
                UPDATE qd_script_sources
                SET name = ?, description = ?, code = ?, template_key = ?,
                    param_schema = ?::jsonb, metadata = ?::jsonb, updated_at = NOW()
                WHERE id = ? AND user_id = ?
                """,
                (
                    name,
                    description,
                    code,
                    template_key,
                    _json_dump(param_schema),
                    _json_dump(metadata),
                    source_id,
                    int(user_id),
                ),
            )
            if cur.rowcount <= 0:
                cur.close()
                return None
            version_no = self._insert_version(
                cur,
                source_id,
                user_id,
                name,
                description,
                code,
                template_key,
                param_schema,
                metadata,
            )
            db.commit()
            cur.close()

        restored = self.get_source(source_id, user_id=user_id) or {}
        restored["version_no"] = version_no
        return restored

    def delete_source(self, source_id: int, user_id: int) -> bool:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute("DELETE FROM qd_script_sources WHERE id = ? AND user_id = ?", (int(source_id), int(user_id)))
            ok = cur.rowcount > 0
            db.commit()
            cur.close()
        return ok

    def create_from_marketplace_asset(self, buyer_id: int, asset: Dict[str, Any]) -> int:
        now = int(time.time())
        return self.create_source(
            {
                "user_id": buyer_id,
                "name": asset.get("name") or "Purchased Script",
                "description": asset.get("description") or "",
                "code": asset.get("code") or "",
                "source_marketplace_indicator_id": asset.get("id"),
                "visibility": "private",
                "status": "draft",
                "metadata": {
                    "from_marketplace": True,
                    "purchased_at": now,
                    "asset_type": "script_template",
                    "code_hidden": bool(asset.get("is_encrypted") or asset.get("code_hidden") or False),
                },
            }
        )


_service: Optional[ScriptSourceService] = None


def get_script_source_service() -> ScriptSourceService:
    global _service
    if _service is None:
        _service = ScriptSourceService()
    return _service
