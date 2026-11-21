"""Check v7 SQLite migration, index maintenance, and source-level GPS with the shipped SQL."""
import re
from pathlib import Path

from storage_smoke import MEMORY, body, connect, migrate, run

KOTLIN = Path(__file__).resolve().parents[1] / "modules/nimby-gallery/android/src/main/java/dev/nimby/gallery"
INDEX = (KOTLIN / "MemoryIndex.kt").read_text()


def install_index(db):
    insert = re.search(r'val insert = """(.*?)"""', INDEX, re.S).group(1)
    for statement in re.findall(r'db\.execSQL\("""(.*?)"""\)', INDEX, re.S):
        if "${action.lowercase()}" in statement:
            db.execute(insert)
            for action in ("INSERT", "UPDATE", "DELETE"):
                db.execute(statement.replace("${action.lowercase()}", action.lower())
                           .replace("$action", action)
                           .replace("$row", "OLD" if action == "DELETE" else "NEW")
                           .replace("$insert", insert))
        else:
            db.execute(statement.replace("$insert", insert))
    db.execute('CREATE INDEX photo_location_range ON photo_locations(latitude, longitude)')


def source(db, uri, image_id, captured):
    db.execute("""INSERT OR REPLACE INTO sources(uri, image_id, name, album, bucket, source, media_id, captured,
        width, height, bytes, modified, version) VALUES (?, ?, 'Photo', 'Camera', 'camera', 'gallery', ?, ?,
            384, 384, 10, 0, ?)""", (uri, image_id, image_id, captured, str(captured)))


def query(db, terms):
    return [item[0] for item in db.execute("SELECT docid FROM memory_search WHERE memory_search MATCH ?", (terms,))]


def run_smoke():
    db = connect(":memory:")
    run(db, body("override fun onCreate", "override fun onUpgrade"))
    migrate(db)
    db.executemany("INSERT INTO images(id, fingerprint, status, kind, category, collection) VALUES (?, ?, ?, ?, ?, ?)", [
        (1, "a", "complete", "screenshot", "Screenshots", "Home office"),
        (2, "b", "pending", "photo", None, "Pending"),
    ])
    source(db, "content://east", 1, 1)
    source(db, "content://west", 1, 2)
    source(db, "content://center", 2, 3)
    install_index(db)
    assert query(db, '"home" "office"') == [1]
    assert not query(db, "pending")

    db.execute("UPDATE images SET status='complete', tags='[{\"label\":\"golden_gate_bridge\"}]' WHERE id=2")
    assert query(db, '"golden" "bridge"') == [2]
    db.execute("INSERT INTO memory_details(image_id, ocr_text, place) VALUES (1, 'November electricity bill', 'Ahmedabad')")
    assert query(db, '"electricity" "ahmedabad"') == [1]
    db.execute("UPDATE images SET decision='kept', collection='Utilities' WHERE id=1")
    assert query(db, 'utilities') == [1]
    assert not query(db, 'office')
    db.execute("UPDATE memory_details SET ocr_text=NULL WHERE image_id=1")
    assert not query(db, 'electricity')
    assert query(db, 'ahmedabad') == [1]

    db.execute("UPDATE images SET aesthetic=.8, keeper=.7 WHERE id=2")
    recall = body('fun searchMemory(', 'private fun memorySource(')
    score_query = re.search(r'rawQuery\("""(SELECT images.id.*?)"""', recall, re.S).group(1)
    score_query = (score_query.replace('$reviewCategory', 'images.category').replace('$from', 'FROM images')
                   .replace('${filters.joinToString(" AND ")}', 'images.id = 2').replace('$sort', '').replace('$safeOffset', '0'))
    assert list(db.execute(score_query))[0][9:] == (.8, .7)

    save = re.search(r'"""(INSERT OR REPLACE INTO photo_locations.*?)"""', MEMORY, re.S).group(1)
    db.execute(save, (25, 179.5, "content://east", "1"))
    db.execute(save, (26, -179.5, "content://west", "2"))
    db.execute(save, (27, 4, "content://center", "3"))
    map_sql = re.search(r'fun forEachMapPhoto.*?rawQuery\("""(.*?)"""', MEMORY, re.S).group(1)
    map_sql = map_sql.replace("$longitudes", "(g.longitude >= ? OR g.longitude <= ?)").replace("${dates.first}", "")
    assert [item[1] for item in db.execute(map_sql, (0, 30, 170, -170))] == ["content://west", "content://east"]
    db.execute("INSERT INTO archive VALUES('content://west', 'Copy', 'Camera', 10, '2', 1, 2, 0)")
    assert [item[1] for item in db.execute(map_sql, (0, 30, 170, -170))] == ["content://east"]
    source(db, "content://east", 1, 4)
    assert not list(db.execute(map_sql, (0, 30, 170, -170)))
    db.execute("DELETE FROM sources WHERE image_id=1")
    db.execute("DELETE FROM images WHERE id=1")
    assert not query(db, 'ahmedabad')
    assert not list(db.execute("SELECT 1 FROM photo_locations WHERE uri='content://west'"))
    print("Visual Memory migration, FTS changes, per-source EXIF scope and clearing tests passed")


if __name__ == '__main__':
    run_smoke()
