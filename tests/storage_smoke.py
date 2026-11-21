"""Exercise Nimby's schema and representative SQL on host SQLite."""
import re
import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "modules/nimby-gallery/android/src/main"
KOTLIN = NATIVE / "java/dev/nimby/gallery"
MEMORY = (KOTLIN / "GalleryMemory.kt").read_text()
BRIDGE = (KOTLIN / "GalleryModule.kt").read_text()
ARCHIVE_UI = (ROOT / "src/ArchiveScreen.tsx").read_text()


def body(start, end):
    return MEMORY.split(start, 1)[1].split(end, 1)[0]


def schema(text):
    regex = r'db\.execSQL\((?:"""(.*?)"""|"([^"]*)")'
    return [a or b for a, b in re.findall(regex, text, re.S)]


def run(db, section):
    for statement in schema(section):
        db.execute(statement)


def connect(path):
    db = sqlite3.connect(path)
    db.execute("PRAGMA foreign_keys=ON")
    return db


def scalar(db, sql, args=()):
    return db.execute(sql, args).fetchone()[0]


def migrate(db):
    run(db, body("private fun createSettingsTables", "fun beginScan"))
    run(db, body("private fun createArchiveTables", "private val visible"))
    run(db, body("private fun addInsightColumns", "private fun createArchiveTables"))
    run(db, body("private fun addScanScope", "private fun addInsightColumns"))


def test_storage():
    with tempfile.TemporaryDirectory() as folder:
        file = str(Path(folder) / "gallery.sqlite")
        db = connect(file)
        run(db, body("override fun onCreate", "override fun onUpgrade"))
        db.execute("""INSERT INTO images (id, fingerprint, status, engine, kind, category, decision, collection)
            VALUES (1, 'same-sha', 'complete', '4.3.0', 'screenshot', 'Screenshots', 'kept', 'Ideas')""")
        db.executemany("""INSERT INTO sources(uri,image_id,name,album,bucket,source,media_id,captured,width,height,bytes,modified,version)
            VALUES (?,1,?,'Camera','external|1','gallery',?,0,384,384,100,0,?)""", [
                ("content://one", "one.png", 1, "old"), ("content://two", "two.png", 2, "old"),
            ])
        migrate(db)
        assert scalar(db, "SELECT collection FROM images WHERE id=1") == "Ideas"
        assert scalar(db, "SELECT COUNT(*) FROM sources WHERE image_id=1") == 2
        duplicate_sql = re.search(r'fun duplicateGroups.*?rawQuery\("""(.*?)"""', MEMORY, re.S).group(1)
        assert len(db.execute(duplicate_sql).fetchall()) == 2
        db.execute("INSERT INTO scans(started,phase,scope) VALUES(1,'running','{}')")
        selection = re.search(r'private val visible = """(.*?)"""', MEMORY, re.S).group(1).strip()
        for uri in ("content://one", "content://two"):
            db.execute("INSERT INTO archive VALUES(?, 'Photo', 'Camera', 100, 'old', 1, 2592000001, 0)", (uri,))
        assert scalar(db, f"SELECT COUNT(*) FROM images WHERE {selection}") == 0
        assert db.execute(duplicate_sql).fetchall() == []
        assert scalar(db, "SELECT COUNT(*) FROM sources") == 2
        db.commit()
        db.close()

        db = connect(file)
        assert scalar(db, "SELECT COUNT(*) FROM archive WHERE eligible < 2592000002") == 2
        assert scalar(db, "SELECT COUNT(*) FROM confirmed_deletions") == 0
        assert scalar(db, "SELECT phase FROM scans") == "running"
        db.execute("DELETE FROM archive WHERE uri=?", ("content://one",))
        assert scalar(db, f"SELECT COUNT(*) FROM images WHERE {selection}") == 1
        assert scalar(db, "SELECT COUNT(*) FROM sources") == 2
        cache = re.search(r'fun cachedPhotos.*?rawQuery\("""(.*?)"""', MEMORY, re.S).group(1).replace("$keys", "?")
        assert db.execute(cache, ("4.3.0", "content://one")).fetchone() == ("content://one", "old")
        assert not db.execute(cache, ("different-model", "content://one")).fetchall()
        assert db.execute(cache, ("4.3.0", "content://one")).fetchone()[1] != "modified"
        db.execute("INSERT INTO images (id, fingerprint, status) VALUES (2, 'different-sha', 'complete')")
        db.execute("INSERT INTO near_matches VALUES(1,2,0.99)")
        clear_sql = re.search(r'db.execSQL\("""(UPDATE images SET status=.*?)"""\)', MEMORY, re.S).group(1)
        db.execute("DELETE FROM near_matches")
        db.execute(clear_sql)
        assert scalar(db, "SELECT status FROM images WHERE id=1") == "pending"
        assert scalar(db, "SELECT collection FROM images WHERE id=1") == "Ideas"
        db.execute("DELETE FROM sources")
        db.execute("DELETE FROM images")
        assert scalar(db, "SELECT COUNT(*) FROM archive") == 1
        assert scalar(db, "SELECT COUNT(*) FROM confirmed_deletions") == 0


def test_deletion_wiring():
    assert "MediaStore.createDeleteRequest" in BRIDGE
    assert "payload.resultCode == Activity.RESULT_OK" in BRIDGE
    assert "if (approved) memory.recordConfirmedDeletion" in BRIDGE
    assert "item.eligible <= now" in MEMORY
    assert "current.version == item.version" in MEMORY
    assert "gallery.confirmAbsent" in MEMORY
    assert "contentResolver.delete(" not in BRIDGE
    assert "Permanently delete these originals?" in ARCHIVE_UI
    assert "Continue to Android" in ARCHIVE_UI
    assert (NATIVE / "assets/eye/self-test.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


if __name__ == "__main__":
    test_storage()
    test_deletion_wiring()
    print("Migration, archive persistence/restore, cached version SQL, and deletion authorization wiring passed")
