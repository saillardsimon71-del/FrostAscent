#!/usr/bin/env python3
"""Safe, offline RenderWolf Slots Studio export importer (Python standard library).

No undocumented RenderWolf API calls, external dependencies or paid operations.
"""
from __future__ import annotations

import argparse
from contextlib import nullcontext
import hashlib
import json
import re
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

MAX_FILES = 500
MAX_TOTAL_BYTES = 512 * 1024 * 1024
MAX_FILE_BYTES = 128 * 1024 * 1024

MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".psd": "image/vnd.adobe.photoshop",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
}
ROLES = {
    "symbol", "character", "background", "reel-frame", "ui",
    "overlay", "animation", "sfx", "music", "other", "unassigned",
}
ID_RE = re.compile(r"^[a-z][a-z0-9._-]{0,79}$")
GAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


class ImportErrorSafe(ValueError):
    """Unsafe or invalid export content."""


def safe_path(raw: str) -> str:
    if not raw or "\x00" in raw or raw.startswith(("/", "\\")):
        raise ImportErrorSafe(f"Unsafe asset path: {raw!r}")
    if "\\" in raw or re.match(r"^[A-Za-z]:", raw):
        raise ImportErrorSafe(f"Unsafe Windows-style asset path: {raw!r}")
    path = PurePosixPath(raw)
    if any(p in ("", ".", "..") for p in raw.split("/")) or path.is_absolute():
        raise ImportErrorSafe(f"Unsafe asset path: {raw!r}")
    if path.parts[0].startswith(".") or any(p.startswith(".") for p in path.parts):
        raise ImportErrorSafe(f"Hidden asset path is not allowed: {raw!r}")
    return path.as_posix()


def is_asset(name: str) -> bool:
    return PurePosixPath(name).suffix.lower() in MEDIA_TYPES


def sniff_type(path: Path, suffix: str) -> dict:
    data = path.read_bytes()[:32]
    ok = {
        ".png": data.startswith(b"\x89PNG\r\n\x1a\n") and data[12:16] == b"IHDR",
        ".jpg": data.startswith(b"\xff\xd8\xff"),
        ".jpeg": data.startswith(b"\xff\xd8\xff"),
        ".webp": data.startswith(b"RIFF") and data[8:12] == b"WEBP",
        ".gif": data.startswith((b"GIF87a", b"GIF89a")),
        ".psd": data.startswith(b"8BPS\x00\x01"),
        ".mp4": len(data) >= 12 and data[4:8] == b"ftyp",
        ".webm": data.startswith(b"\x1a\x45\xdf\xa3"),
        ".wav": data.startswith(b"RIFF") and data[8:12] == b"WAVE",
        ".ogg": data.startswith(b"OggS"),
    }[suffix]
    if not ok:
        raise ImportErrorSafe(f"File signature does not match {suffix}: {path.name}")
    result = {"mediaType": MEDIA_TYPES[suffix]}
    if suffix == ".png" and len(data) > 25:
        result["alphaCapable"] = data[25] in (4, 6)
        result["width"] = int.from_bytes(data[16:20], "big")
        result["height"] = int.from_bytes(data[20:24], "big")
    return result


def read_mapping(path: Path | None) -> dict:
    if path is None:
        return {}
    obj = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(obj, dict) or not isinstance(obj.get("assets"), list):
        raise ImportErrorSafe("Mapping must contain an assets array")
    result = {}
    ids = set()
    for item in obj["assets"]:
        if not isinstance(item, dict):
            raise ImportErrorSafe("Each mapping entry must be an object")
        source = safe_path(item.get("source", ""))
        asset_id, role = item.get("id"), item.get("role")
        if not isinstance(asset_id, str) or not ID_RE.fullmatch(asset_id):
            raise ImportErrorSafe(f"Invalid asset id: {asset_id!r}")
        if role not in ROLES - {"unassigned"}:
            raise ImportErrorSafe(f"Invalid role: {role!r}")
        if source in result or asset_id in ids:
            raise ImportErrorSafe(f"Duplicate source or id: {source}")
        ids.add(asset_id)
        result[source] = {"id": asset_id, "role": role}
    return result


def collect_entries(input_path: Path, archive: zipfile.ZipFile | None) -> list:
    entries = []
    seen = set()
    if archive:
        candidates = ((i.filename, i) for i in archive.infolist() if not i.is_dir())
    else:
        candidates = ((p.relative_to(input_path).as_posix(), p)
                      for p in input_path.rglob("*") if not p.is_dir())
    for raw, item in candidates:
        relative = safe_path(raw)
        if relative in seen:
            raise ImportErrorSafe(f"Duplicate archive path: {relative}")
        seen.add(relative)
        if archive:
            mode = item.external_attr >> 16
            if stat.S_IFMT(mode) == stat.S_IFLNK:
                raise ImportErrorSafe(f"Symlinks not allowed in ZIP: {relative}")
            if item.flag_bits & 1:
                raise ImportErrorSafe(f"Encrypted asset not supported: {relative}")
            declared_size = item.file_size
        else:
            if item.is_symlink() or not item.is_file():
                raise ImportErrorSafe(f"Unsafe input entry: {relative}")
            declared_size = item.stat().st_size
        if not is_asset(relative):
            continue  # Ignore export documentation, metadata, and other non-media files.
        if declared_size > MAX_FILE_BYTES:
            raise ImportErrorSafe(f"Asset exceeds size limit: {relative}")
        entries.append((relative, item))
    if len(entries) > MAX_FILES:
        raise ImportErrorSafe("Too many assets in export")
    return sorted(entries, key=lambda row: row[0])


def import_export(input_path: Path, output_dir: Path, game_id: str,
                  mapping_path: Path | None = None) -> dict:
    if not GAME_RE.fullmatch(game_id):
        raise ImportErrorSafe("game-id must be a lowercase hyphenated slug")
    input_path = input_path.expanduser().resolve()
    output_dir = output_dir.expanduser().absolute()
    if not input_path.exists() or not (input_path.is_dir() or zipfile.is_zipfile(input_path)):
        raise ImportErrorSafe("Input must be a directory or a valid ZIP export")
    if output_dir.exists():
        raise ImportErrorSafe(f"Output already exists; refusing overwrite: {output_dir}")
    mapping = read_mapping(mapping_path)
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".renderwolf-stage-", dir=output_dir.parent))
    archive_context = zipfile.ZipFile(input_path, "r") if input_path.is_file() else nullcontext(None)
    try:
        with archive_context as archive:
            entries = collect_entries(input_path, archive)
            if not entries:
                raise ImportErrorSafe("No supported media assets found")
            paths = {rel for rel, _ in entries}
            missing = set(mapping) - paths
            if missing:
                raise ImportErrorSafe(f"Mapped sources absent from export: {sorted(missing)}")
            used_ids = {data["id"] for data in mapping.values()}
            manifest_assets = []
            total_bytes = 0
            for rel, item in entries:
                suffix = PurePosixPath(rel).suffix.lower()
                target = stage / "assets" / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                written = 0
                source_context = archive.open(item) if archive else item.open("rb")
                with source_context as source, target.open("xb") as dest:
                    while chunk := source.read(1024 * 1024):
                        written += len(chunk)
                        total_bytes += len(chunk)
                        if written > MAX_FILE_BYTES or total_bytes > MAX_TOTAL_BYTES:
                            raise ImportErrorSafe("Export exceeds allowed uncompressed size")
                        digest.update(chunk)
                        dest.write(chunk)
                inspection = sniff_type(target, suffix)
                if rel in mapping:
                    spec = mapping[rel]
                else:
                    stub = re.sub(r"[^a-z0-9]+", "-", rel.lower()).strip("-")[:45]
                    generated = f"asset-{stub}-{hashlib.sha256(rel.encode()).hexdigest()[:8]}"
                    if generated in used_ids:
                        raise ImportErrorSafe("Generated asset ID collision")
                    used_ids.add(generated)
                    spec = {"id": generated, "role": "unassigned"}
                manifest_assets.append({
                    "id": spec["id"], "role": spec["role"],
                    "sourcePath": rel,
                    "url": f"/{game_id}/renderwolf/assets/{rel}",
                    "sha256": digest.hexdigest(), "bytes": written,
                    **inspection,
                })
            manifest = {
                "schemaVersion": 1, "provider": "renderwolf-slots-studio-export",
                "gameId": game_id, "publicBase": f"/{game_id}/renderwolf",
                "assets": manifest_assets,
            }
            (stage / "manifest.json").write_text(
                json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            if output_dir.exists():
                raise ImportErrorSafe("Output appeared during import; refusing overwrite")
            stage.rename(output_dir)
            return manifest
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path,
                        help="RenderWolf exported directory or ZIP")
    parser.add_argument("--out", required=True, type=Path,
                        help="New output directory, e.g. public/frost-ascent/renderwolf")
    parser.add_argument("--game", required=True, help="Game slug, e.g. frost-ascent")
    parser.add_argument("--map", dest="mapping", type=Path,
                        help="Optional JSON mapping of source paths to IDs and roles")
    args = parser.parse_args()
    try:
        manifest = import_export(args.input, args.out, args.game, args.mapping)
    except (ImportErrorSafe, OSError, zipfile.BadZipFile, json.JSONDecodeError) as exc:
        parser.exit(2, f"RenderWolf import failed: {exc}\n")
    print(json.dumps({
        "status": "ok", "game": manifest["gameId"],
        "assets": len(manifest["assets"]), "output": str(args.out),
        "unassigned": sum(a["role"] == "unassigned" for a in manifest["assets"]),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
