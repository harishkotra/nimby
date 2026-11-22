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
DIALOG_UI = (ROOT / "src/Dialogs.tsx").read_text()


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
    run(db, body("private fun createScanResults", "private fun addScanScope"))
    run(db, body("private fun addDailyDiscoveries", "private fun createVisualSearchIndex"))


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


def test_auto_scan_storage():
    db = connect(":memory:")
    run(db, body("override fun onCreate", "override fun onUpgrade"))
    migrate(db)
    db.execute("INSERT INTO images(id,fingerprint,status,engine) VALUES(1,'hash','complete','4.3.0')")
    db.executemany("""INSERT INTO sources(uri,image_id,name,album,bucket,source,media_id,captured,width,height,bytes,modified,version)
        VALUES (?,1,'Photo','Camera','external|1','gallery',?,0,384,384,100,0,'indexed')""", [
        ("content://unchanged", 1), ("content://edited", 2), ("content://archived", 3),
    ])
    db.execute("INSERT INTO archive VALUES('content://archived','Photo','Camera',100,'indexed',1,2592000001,0)")
    versions = {"content://unchanged": "indexed", "content://edited": "updated", "content://archived": "updated", "content://new": "new"}
    placeholders = ",".join("?" for _ in versions)
    cache = re.search(r'fun cachedPhotos.*?rawQuery\("""(.*?)"""', MEMORY, re.S).group(1).replace("$keys", placeholders)
    archived_sql = re.search(r'fun pendingAutoScanPhotos.*?rawQuery\("(.*?)"', MEMORY, re.S).group(1).replace("$slots", placeholders)
    cached = {uri for uri, version in db.execute(cache, ("4.3.0", *versions)) if versions[uri] == version}
    archived = {row[0] for row in db.execute(archived_sql, tuple(versions))}
    assert set(versions) - cached - archived == {"content://edited", "content://new"}

    completed = re.search(r'fun hasCompletedScan.*?rawQuery\(\s*"(.*?)"', MEMORY, re.S).group(1)
    db.execute("INSERT INTO scans(started,phase,total,failed) VALUES(1,'complete',2,2)")
    assert not db.execute(completed).fetchone()
    db.execute("INSERT INTO scans(started,phase,total,cached) VALUES(2,'complete',1,1)")
    assert db.execute(completed).fetchone()
    db.execute("INSERT INTO scans(started,phase,scope) VALUES(3,'interrupted','{\"albums\":[],\"uris\":[]}')")
    db.execute("INSERT INTO scans(started,phase,total,analyzed) VALUES(4,'complete',1,1)")
    resume = re.search(r'fun interruptedScope.*?rawQuery\("""(.*?)"""', MEMORY, re.S).group(1)
    assert db.execute(resume).fetchone() == ('{"albums":[],"uris":[]}', "interrupted")
    db.close()
    assert "Permanently delete these originals?" in ARCHIVE_UI
    assert "Continue to Android" in ARCHIVE_UI
    assert "action?.run()" in DIALOG_UI
    assert 'label="Cancel" subtle run={dismiss}' in DIALOG_UI
    assert "Alert.alert" not in ARCHIVE_UI
    assert (NATIVE / "assets/eye/self-test.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


def test_scan_results():
    db = connect(":memory:")
    run(db, body("override fun onCreate", "override fun onUpgrade"))
    migrate(db)
    db.executemany("INSERT INTO scans(id, started, phase) VALUES(?, 1, 'complete')", [(1,), (2,), (3,)])
    db.executemany("""INSERT INTO images(id, fingerprint, status, kind, category) VALUES(?, ?, 'complete', ?, ?)""", [
        (1, "same", "screenshot", "Receipts"),
        (2, "different", "screenshot", None),
        (3, "third", "photo", None),
    ])
    db.executemany("""INSERT INTO sources(uri,image_id,name,album,bucket,source,media_id,captured,width,height,bytes,modified,version)
        VALUES (?,?,'Photo','Camera','camera','gallery',0,0,384,384,10,0,'v1')""", [
        ("content://one", 1), ("content://copy", 1), ("content://two", 2), ("content://three", 3),
    ])
    insert = re.search(r'"""(INSERT OR REPLACE INTO scan_results.*?)"""', MEMORY, re.S).group(1)
    for scan_id, uris in [(2, ["content://one", "content://copy", "content://two"]),
                          (3, ["content://two", "content://three"])]:
        db.execute(insert.replace("$slots", ",".join("?" for _ in uris)), (scan_id, *uris))
    rows = re.search(r'private val scanReviewRows = """(.*?)"""', MEMORY, re.S).group(1)
    category = re.search(r'private val reviewCategory = """(.*?)"""', MEMORY, re.S).group(1)

    def groups(scan):
        return dict(db.execute(f"SELECT {category}, COUNT(*) {rows} GROUP BY {category}", (scan,)))

    assert groups(1) == {}
    assert groups(2) == {"Receipts": 2, "Screenshots": 1}
    assert groups(3) == {"Screenshots": 1, "Photos": 1}
    db.execute("UPDATE sources SET image_id = 3 WHERE uri = 'content://one'")
    db.execute("INSERT INTO archive VALUES('content://copy','Photo','Camera',10,'v1',1,2,0)")
    assert groups(2) == {"Screenshots": 1}
    assert db.execute(f"SELECT s.uri {rows} AND {category} = ?", (3, "Photos")).fetchone() == ("content://three",)
    db.execute("DELETE FROM scans WHERE id = 3")
    assert scalar(db, "SELECT COUNT(*) FROM scan_results WHERE scan_id=3") == 0


def test_revisit_queries():
    db = connect(":memory:")
    run(db, body("override fun onCreate", "override fun onUpgrade"))
    migrate(db)
    images = [(i, "Screenshots", "new", 1_000 + i, 0) for i in range(1, 105)]
    images += [
        (105, "Receipts", "new", 200, 1),
        (106, "Receipts", "new", 100, 0),
        (107, "Documents", "new", 30, 0),
        (108, "Shopping references", "kept", 40, 0),
        (109, "Notes and whiteboards", "new", 50, 0),
    ]
    db.executemany("""INSERT INTO images(id, fingerprint, status, category, decision, analyzed, low_quality)
        VALUES (?1, ?1, 'complete', ?2, ?3, ?4, ?5)""", images)
    db.executemany("""INSERT INTO sources(uri,image_id,name,album,bucket,source,media_id,captured,width,height,bytes,modified,version)
        VALUES (?,?,'Photo','Camera','camera','gallery',0,0,384,384,10,0,'v1')""",
        [(f"content://{photo[0]}", photo[0]) for photo in images])
    db.execute("INSERT INTO archive VALUES('content://109','Photo','Camera',10,'v1',1,2,0)")

    pending = body("fun revisitPicks(", "fun feed(")
    visible = re.search(r'private val visible = """(.*?)"""', MEMORY, re.S).group(1)
    eligible = re.search(r'val eligible = """(.*?)"""', pending, re.S).group(1)
    eligible = eligible.replace("$visible", visible).replace("$filter", "AND id NOT IN (?)")
    category_query = re.search(r'rawQuery\("""(SELECT category.*?)"""', pending, re.S).group(1)
    pick_query = re.search(r'rawQuery\("""(SELECT id.*?)"""', pending, re.S).group(1)
    categories = [row[0] for row in db.execute(category_query.replace("$eligible", eligible), (104,))]
    assert categories == ["Receipts", "Documents", "Screenshots"]
    assert db.execute(pick_query.replace("$eligible", eligible), (104, "Receipts")).fetchone()[0] == 106
    assert db.execute(pick_query.replace("$eligible", eligible), (104, "Screenshots")).fetchone()[0] == 103


def test_daily_discoveries():
    with tempfile.TemporaryDirectory() as folder:
        path = str(Path(folder) / "daily.sqlite")
        db = connect(path)
        run(db, body("override fun onCreate", "override fun onUpgrade"))
        migrate(db)
        db.execute("CREATE TABLE memory_details(image_id INTEGER PRIMARY KEY, qwen_tags TEXT)")
        db.executemany("""INSERT INTO images(id,fingerprint,kind,category,decision,status,analyzed,decided_at)
            VALUES (?1,?1,'photo',?2,?3,'complete',10,?4)""", [
            (1, "Receipts", "kept", 35), (2, "Screenshots", "dismissed", 20),
            (3, "Documents", "kept", 25), (4, None, "new", 0), (5, "Screenshots", "new", 0),
        ])
        db.executemany("""INSERT INTO sources(uri,image_id,name,album,bucket,source,media_id,captured,width,height,bytes,modified,version)
            VALUES (?,?,'Photo','Camera','camera','gallery',0,0,384,384,10,0,'v1')""",
            [(f"content://{image}", image) for image in range(1, 6)])
        db.execute("INSERT INTO archive VALUES('content://3','Photo','Camera',10,'v1',40,50,0)")
        db.execute("INSERT INTO memory_details VALUES (1, '[\"coffee\"]')")
        review_category = re.search(r'private val reviewCategory = """(.*?)"""', MEMORY, re.S).group(1)
        visible = re.search(r'private val visible = """(.*?)"""', MEMORY, re.S).group(1)
        daily_visible = re.search(r'private val dailyVisible = """(.*?)"""', MEMORY, re.S).group(1).replace('$visible', visible)
        history = re.search(r'private fun discoveryFeedback.*?rawQuery\("""(.*?)"""', MEMORY, re.S).group(1)
        history = history.replace('$reviewCategory', review_category)
        assert [(row[0], row[2], row[3]) for row in db.execute(history)] == [
            ('Documents', None, 'archived'), ('Receipts', '["coffee"]', 'kept'), ('Screenshots', None, 'dismissed'),
        ]
        db.execute("DELETE FROM archive WHERE uri='content://3'")
        assert [row[3] for row in db.execute(history)] == ['kept', 'kept', 'dismissed']

        db.executemany("INSERT INTO daily_discoveries VALUES('2026-11-22',?,?,?)", [
            (0, 4, 'From your scanned gallery'), (1, 5, 'From your scanned gallery'),
        ])
        generation = body("private fun chooseDailyDiscoveries", "private fun discoveryFeedback")
        eligible = re.search(r'val eligible = """(.*?)"""', generation, re.S).group(1).replace('$dailyVisible', daily_visible)
        pool = re.search(r'rawQuery\("""(SELECT images.id.*?)"""', generation, re.S).group(1)
        pool = pool.replace('$eligible', eligible).replace('$reviewCategory', review_category)
        assert db.execute(pool, ('2026-10-01', '2026-11-23', 'Photos')).fetchone()[:4] == (4, None, None, '2026-11-22')
        db.commit()
        db.close()
        db = connect(path)
        pick = re.search(r'SELECT images.id, images.kind, images.confidence, images.tags, \$reviewCategory, d.reason(.*?)"""', MEMORY, re.S).group(0)[:-3]
        pick = pick.replace('$reviewCategory', review_category).replace('$dailyVisible', daily_visible)
        assert [row[0] for row in db.execute(pick, ('2026-11-22',))] == [4, 5]
        db.execute("UPDATE images SET decision='dismissed' WHERE id=4")
        assert [row[0] for row in db.execute(pick, ('2026-11-22',))] == [5]
        db.execute("INSERT INTO archive VALUES('content://5','Photo','Camera',10,'v1',40,50,0)")
        assert not list(db.execute(pick, ('2026-11-22',)))
        assert not list(db.execute(pool, ('2026-10-01', '2026-11-23', 'Screenshots')))
        assert scalar(db, "SELECT COUNT(*) FROM daily_discoveries") == 2
        db.execute("DELETE FROM sources WHERE image_id=5")
        db.execute("DELETE FROM images WHERE id=5")
        assert scalar(db, "SELECT COUNT(*) FROM daily_discoveries") == 1
        db.close()


if __name__ == "__main__":
    test_storage()
    test_deletion_wiring()
    test_auto_scan_storage()
    test_scan_results()
    test_revisit_queries()
    test_daily_discoveries()
    print("Migration, scan scopes, Auto-scan, revisit ranking, daily discovery persistence, archive/restore, and deletion authorization wiring passed")
