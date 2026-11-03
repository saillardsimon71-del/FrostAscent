import base64
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from tools.renderwolf_bridge import ImportErrorSafe, import_export

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/vV0AAAAASUVORK5CYII="
)


class RenderWolfBridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.incoming = self.root / "incoming"
        self.incoming.mkdir()
        (self.incoming / "characters").mkdir()
        (self.incoming / "characters" / "yeti.png").write_bytes(PNG)

    def tearDown(self):
        self.tmp.cleanup()

    def test_directory_import_and_mapping(self):
        mapping = self.root / "mapping.json"
        mapping.write_text(json.dumps({
            "assets": [{"source": "characters/yeti.png",
                        "id": "character.yeti", "role": "character"}]
        }))
        out = self.root / "public" / "frost-ascent" / "renderwolf"
        result = import_export(self.incoming, out, "frost-ascent", mapping)
        self.assertEqual(result["assets"][0]["id"], "character.yeti")
        self.assertEqual(result["assets"][0]["role"], "character")
        self.assertEqual(result["assets"][0]["mediaType"], "image/png")
        self.assertEqual(result["assets"][0]["width"], 1)
        self.assertEqual(result["assets"][0]["height"], 1)
        self.assertTrue((out / "assets" / "characters" / "yeti.png").exists())
        self.assertEqual(json.loads((out / "manifest.json").read_text()), result)

    def test_zip_import_without_mapping_is_unassigned(self):
        zipped = self.root / "export.zip"
        with zipfile.ZipFile(zipped, "w") as zf:
            zf.writestr("characters/yeti.png", PNG)
            zf.writestr("README.txt", "ignored documentation")
        out = self.root / "fromzip"
        result = import_export(zipped, out, "another-slot")
        self.assertEqual(len(result["assets"]), 1)
        self.assertEqual(result["assets"][0]["role"], "unassigned")
        self.assertTrue(result["assets"][0]["url"].startswith("/another-slot/renderwolf/"))

    def test_no_overwrite(self):
        out = self.root / "output"
        import_export(self.incoming, out, "frost-ascent")
        with self.assertRaisesRegex(ImportErrorSafe, "already exists"):
            import_export(self.incoming, out, "frost-ascent")

    def test_zip_traversal_rejected_without_file_escape(self):
        zipped = self.root / "bad.zip"
        with zipfile.ZipFile(zipped, "w") as zf:
            zf.writestr("../escape.png", PNG)
        out = self.root / "output"
        with self.assertRaises(ImportErrorSafe):
            import_export(zipped, out, "frost-ascent")
        self.assertFalse(out.exists())
        self.assertFalse((self.root / "escape.png").exists())

    def test_wrong_magic_rejected(self):
        (self.incoming / "characters" / "fake.webp").write_bytes(b"not a webp")
        out = self.root / "output"
        with self.assertRaisesRegex(ImportErrorSafe, "signature"):
            import_export(self.incoming, out, "frost-ascent")
        self.assertFalse(out.exists())

    def test_missing_map_source_rejected(self):
        mapping = self.root / "mapping.json"
        mapping.write_text(json.dumps({
            "assets": [{"source": "characters/missing.png",
                        "id": "character.missing", "role": "character"}]
        }))
        with self.assertRaisesRegex(ImportErrorSafe, "absent"):
            import_export(self.incoming, self.root / "output", "frost-ascent", mapping)

    def test_duplicate_zip_paths_rejected(self):
        zipped = self.root / "duplicates.zip"
        with zipfile.ZipFile(zipped, "w") as zf:
            zf.writestr("characters/yeti.png", PNG)
            zf.writestr("characters/yeti.png", PNG)
        with self.assertRaisesRegex(ImportErrorSafe, "Duplicate"):
            import_export(zipped, self.root / "output", "frost-ascent")

    def test_invalid_game_slug_rejected(self):
        with self.assertRaisesRegex(ImportErrorSafe, "game-id"):
            import_export(self.incoming, self.root / "output", "../../bad")


if __name__ == "__main__":
    unittest.main()
