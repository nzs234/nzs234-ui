# SPDX-License-Identifier: LicenseRef-PolyFormNoncommercial-1.0.0
"""Generate tools/.backend-config-vocab.json — the authoritative backend config vocabulary.

Sources (all real imports / targeted scans, priority order):
  1. pydantic_import          — core.configs.UnifiedTrainingConfig.model_fields keys
                                (the canonical training contract).
  2. pydantic_validation_aliases — AliasChoices(...) declared on those fields
                                (e.g. lpips_latent_* -> lulynx_latent_feature_distillation_*).
  3. field_alias_map_import   — core.services.training.field_alias_map
                                (FIELD_ALIAS_MAP + BLOCK_WEIGHT_FIELD_ALIASES), the
                                launcher's payload-key normalization layer.
  4. lab_contracts_import     — core.contracts.tools Lab request models
                                (TurboLoraRequest / LabDistillerRequest /
                                DitFewStepLoraRequest + bases) consumed by the
                                lulynx-lab pipeline types.
  5. lab_runner_scan          — regex scan of core/tools/lulynx_lab/*.py raw
                                config-dict readers (config.get("X") / "X" in config).
  6. adapter_alias_scan       — regex scan of core/lulynx_trainer/config_adapter*.py
                                (incl. config_adapter_normalizers.py) for payload-side
                                alias keys the adapter reads/renames.

Run from the ui/ directory:
  & "D:\\AI\\lulynx-trainer\\backend\\env\\python\\python.exe" tools/genBackendVocab.py
"""
import json
import re
import sys
from pathlib import Path

UI_TOOLS = Path(__file__).resolve().parent
BACKEND = UI_TOOLS.parents[2] / "backend"
if not BACKEND.is_dir():
    BACKEND = Path(r"D:\AI\lulynx-trainer\backend")
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "core"))

from core.configs import UnifiedTrainingConfig  # noqa: E402

IDENT = re.compile(r"^[a-z][a-z0-9_]{2,80}$")
READ_PATTERNS = [
    re.compile(r"\.pop\(\s*[\"']([A-Za-z0-9_]+)[\"']"),
    re.compile(r"[\"']([A-Za-z0-9_]+)[\"']\s+in\s+(?:normalized_)?data\b"),
    re.compile(r"[\"']([A-Za-z0-9_]+)[\"']\s+in\s+cfg\b"),
    re.compile(r"[\"']([A-Za-z0-9_]+)[\"']\s+in\s+config\b"),
    re.compile(r"\.get\(\s*[\"']([A-Za-z0-9_]+)[\"']"),
    re.compile(r"\.setdefault\(\s*[\"']([A-Za-z0-9_]+)[\"']"),
    # positional reader helpers: _float_value(config, "key", default)
    re.compile(r"\(\s*config\s*,\s*[\"']([A-Za-z0-9_]+)[\"']"),
    # rename-map entries anywhere in a dict literal:  "legacy_key": "canonical",
    re.compile(r"[\"']([A-Za-z0-9_]+)[\"']\s*:\s*[\"'][A-Za-z0-9_]+[\"']"),
    # alias-table dict literals:  {"legacy_key": "canonical", ...}
    re.compile(r"\{\s*[\"']([A-Za-z0-9_]+)[\"']\s*:"),
    re.compile(r"\(\s*[\"']([A-Za-z0-9_]+)[\"']\s*,"),
]


def scan_file(path: Path, patterns) -> set:
    hits = set()
    text = path.read_text(encoding="utf-8", errors="replace")
    for pattern in patterns:
        for hit in pattern.findall(text):
            if IDENT.match(hit):
                hits.add(hit)
    return hits


def main() -> None:
    # 1. canonical contract
    fields = UnifiedTrainingConfig.model_fields
    canonical = sorted(fields.keys())
    canonical_set = set(canonical)

    # 2. validation aliases (AliasChoices)
    valias = set()
    for field in fields.values():
        va = getattr(field, "validation_alias", None)
        if va is None:
            continue
        choices = getattr(va, "choices", None)
        for choice in ([str(c) for c in choices] if choices else [str(va)]):
            if IDENT.match(choice):
                valias.add(choice)

    # 3. launcher field alias map
    from core.services.training.field_alias_map import (
        BLOCK_WEIGHT_FIELD_ALIASES,
        FIELD_ALIAS_MAP,
    )
    aliasmap = set(FIELD_ALIAS_MAP) | set(FIELD_ALIAS_MAP.values())
    aliasmap |= set(BLOCK_WEIGHT_FIELD_ALIASES) | set(BLOCK_WEIGHT_FIELD_ALIASES.values())
    aliasmap = {k for k in aliasmap if IDENT.match(k)}

    # 4. lab request contracts
    import core.contracts.tools as lab_tools
    lab_contract_keys = set()
    for name in dir(lab_tools):
        obj = getattr(lab_tools, name)
        if isinstance(obj, type) and hasattr(obj, "model_fields"):
            lab_contract_keys |= {k for k in obj.model_fields if IDENT.match(k)}

    # 5. lab runner raw config readers
    lab_dir = BACKEND / "core" / "tools" / "lulynx_lab"
    lab_runner_keys = set()
    lab_files = sorted(p.name for p in lab_dir.glob("*.py"))
    lab_files.append("core/services/lab_runner_config.py")
    for path in lab_dir.glob("*.py"):
        lab_runner_keys |= scan_file(path, READ_PATTERNS)
    lab_runner_keys |= scan_file(BACKEND / "core" / "services" / "lab_runner_config.py", READ_PATTERNS)
    lab_runner_keys = {k for k in lab_runner_keys if IDENT.match(k)}

    # 6. config_adapter alias scan
    adapter_dir = BACKEND / "core" / "lulynx_trainer"
    adapter_files = sorted(p.name for p in adapter_dir.glob("config_adapter*.py"))
    adapter_hits = set()
    for name in adapter_files:
        adapter_hits |= scan_file(adapter_dir / name, READ_PATTERNS)
    adapter_hits = {k for k in adapter_hits if IDENT.match(k)}

    def external(source: set) -> list:
        return sorted(source - canonical_set)

    snapshot = {
        "schema_version": 2,
        "backend_root": str(BACKEND),
        "sources": {
            "pydantic_import": {
                "target": "core.configs:UnifiedTrainingConfig.model_fields",
                "method": "real_import",
                "key_count": len(canonical),
            },
            "pydantic_validation_aliases": {
                "method": "real_import",
                "key_count": len(external(valias)),
            },
            "field_alias_map": {
                "method": "real_import",
                "target": "core.services.training.field_alias_map",
                "key_count": len(external(aliasmap)),
            },
            "lab_contracts": {
                "method": "real_import",
                "target": "core.contracts.tools (Lab request models)",
                "key_count": len(external(lab_contract_keys)),
            },
            "lab_runner_scan": {
                "method": "regex_scan",
                "files": lab_files,
                "key_count": len(external(lab_runner_keys)),
            },
            "adapter_alias_scan": {
                "method": "regex_scan",
                "files": adapter_files,
                "key_count": len(external(adapter_hits)),
            },
        },
        "canonical_keys": canonical,
        "adapter_alias_keys": sorted(
            (valias | aliasmap | lab_contract_keys | lab_runner_keys | adapter_hits) - canonical_set
        ),
    }
    out_path = UI_TOOLS / ".backend-config-vocab.json"
    out_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1), encoding="utf-8")
    print(
        f"canonical={len(canonical)} "
        f"valias={len(external(valias))} aliasmap={len(external(aliasmap))} "
        f"lab_contracts={len(external(lab_contract_keys))} lab_scan={len(external(lab_runner_keys))} "
        f"adapter={len(external(adapter_hits))} -> {out_path}"
    )


if __name__ == "__main__":
    main()
