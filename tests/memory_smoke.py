"""Check v7 SQLite migration, index maintenance, and source-level GPS with the shipped SQL."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from storage_smoke import MEMORY, body, connect, migrate, run

KOTLIN = Path(__file__).resolve().parents[1] / "modules/nimby-gallery/android/src/main/java/dev/nimby/gallery"
INDEX = (KOTLIN / "MemoryIndex.kt").read_text()


def install_index(db, legacy=False, triggers_only=False):
    insert = re.search(r'val insert = """(.*?)"""', INDEX, re.S).group(1)
    if legacy:
        insert = insert.replace(" || ' ' || COALESCE(details.qwen_tags, '')", '')
    for statement in re.findall(r'db\.execSQL\("""(.*?)"""\)', INDEX, re.S):
        if triggers_only and not statement.startswith('CREATE TRIGGER '):
            continue
        if legacy:
            statement = statement.replace('place TEXT, qwen_tags TEXT', 'place TEXT')
        if "${action.lowercase()}" in statement:
            if not triggers_only:
                db.execute(insert)
            for action in ("INSERT", "UPDATE", "DELETE"):
                db.execute(statement.replace("${action.lowercase()}", action.lower())
                           .replace("$action", action)
                           .replace("$row", "OLD" if action == "DELETE" else "NEW")
                           .replace("$insert", insert))
        else:
            db.execute(statement.replace("$insert", insert))
    if not triggers_only:
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
    assert list(db.execute(score_query))[0][9:11] == (.8, .7)

    save = re.search(r'"""(INSERT OR REPLACE INTO photo_locations.*?)"""', MEMORY, re.S).group(1)
    db.execute(save, (25, 179.5, "content://east", "1"))
    db.execute(save, (26, -179.5, "content://west", "2"))
    db.execute(save, (27, 4, "content://center", "3"))
    map_sql = re.search(r'fun forEachMapPhoto.*?rawQuery\("""(.*?)"""', MEMORY, re.S).group(1)
    map_sql = map_sql.replace("$longitudes", "(g.longitude >= ? OR g.longitude <= ?)").replace("${dates.first}", "")
    scan_join = re.search(r'val scan = if \(scanId == null\) "" else "(JOIN scan_results.*?)"', MEMORY).group(1)
    scan_map = map_sql.replace('$scan', scan_join)
    map_sql = map_sql.replace('$scan', '')
    db.executemany("INSERT INTO scans(id,started,phase) VALUES (?,1,'complete')", [(11,), (12,), (13,)])
    db.executemany('INSERT INTO scan_results(scan_id,uri,image_id) VALUES (?,?,?)', [
        (11, 'content://east', 1), (12, 'content://west', 1), (13, 'content://center', 2),
    ])
    assert [item[1] for item in db.execute(scan_map, (11, 0, 30, 170, -170))] == ['content://east']
    assert [item[1] for item in db.execute(scan_map, (12, 0, 30, 170, -170))] == ['content://west']
    assert [item[1] for item in db.execute(map_sql, (0, 30, 170, -170))] == ["content://west", "content://east"]
    db.execute("INSERT INTO archive VALUES('content://west', 'Copy', 'Camera', 10, '2', 1, 2, 0)")
    assert not list(db.execute(scan_map, (12, 0, 30, 170, -170)))
    assert [item[1] for item in db.execute(map_sql, (0, 30, 170, -170))] == ["content://east"]
    source(db, "content://east", 1, 4)
    assert not list(db.execute(scan_map, (11, 0, 30, 170, -170)))
    assert not list(db.execute(map_sql, (0, 30, 170, -170)))
    db.execute("DELETE FROM sources WHERE image_id=1")
    db.execute("DELETE FROM images WHERE id=1")
    assert not query(db, 'ahmedabad')
    assert not list(db.execute("SELECT 1 FROM photo_locations WHERE uri='content://west'"))
    print("Visual Memory migration, FTS, and whole-gallery and scan-scoped EXIF checks passed")


def run_recall_location_and_tags():
    db = connect(':memory:')
    run(db, body('override fun onCreate', 'override fun onUpgrade'))
    migrate(db)
    db.executemany('INSERT INTO images(id, fingerprint, status, kind) VALUES (?, ?, \'complete\', \'photo\')',
                   [(photo, str(photo)) for photo in range(1, 7)])
    jan = int(datetime(2025, 1, 15, tzinfo=timezone.utc).timestamp() * 1000)
    july = int(datetime(2025, 7, 15, tzinfo=timezone.utc).timestamp() * 1000)
    jan_last_year = int(datetime(2024, 1, 15, tzinfo=timezone.utc).timestamp() * 1000)
    sources = [('good', 1, jan, 1.36, 103.99), ('different-place', 2, jan, 35.6, 139.7),
               ('different-month', 2, july, 1.36, 103.99), ('archived', 3, jan, 1.36, 103.99),
               ('stale', 4, jan, 1.36, 103.99), ('other-year', 5, jan_last_year, 1.36, 103.99),
               ('manually-named', 6, jan, 0, 0)]
    for name, image_id, captured, _, _ in sources:
        source(db, 'content://' + name, image_id, captured)
    install_index(db, legacy=True)
    db.execute("INSERT INTO memory_details(image_id,ocr_text,place) VALUES(6,'old receipt','Singapore')")
    assert query(db, 'receipt') == [6]
    db.execute(re.search(r'db\.execSQL\("(ALTER TABLE memory_details ADD COLUMN.*?)"\)', INDEX).group(1))
    names = list(db.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'memory_%'"))
    for (name,) in names:
        db.execute(f'DROP TRIGGER {name}')
    install_index(db, triggers_only=True)
    assert query(db, 'receipt') == [6]
    db.execute("UPDATE memory_details SET qwen_tags='[\"brick wall\",\"outdoor cafe\"]' WHERE image_id=6")
    assert query(db, '"brick" "receipt"') == [6]
    db.execute("UPDATE memory_details SET qwen_tags=NULL WHERE image_id=6")
    assert query(db, 'brick') == []
    assert query(db, 'receipt') == [6]

    for name, _, captured, lat, lon in sources:
        db.execute('INSERT INTO photo_locations VALUES (?, ?, ?, ?)',
                   ('content://' + name, 'old-version' if name == 'stale' else str(captured), lat, lon))
    db.execute("INSERT INTO archive VALUES('content://archived','Photo','Camera',10,'1',1,2,0)")
    region_file = KOTLIN.parents[3] / 'assets' / 'photo-map' / 'recall-places.json'
    [[lat, lon]] = json.loads(region_file.read_text())['Singapore']
    filter_code = body('private fun recallSourceFilter', 'fun searchablePlaces')
    place_clause = re.search(r'val saved = """(.*?)"""', filter_code, re.S).group(1)
    date_clause = re.search(r'sql\.append\("( AND strftime.*?)"\)', filter_code).group(1).replace('$alias', 'sources')
    gps_clause = re.search(r'return """\$source(.*?)"""', filter_code, re.S).group(1)
    scoped = gps_clause.replace('$saved', place_clause).replace('$bounds',
        '(g.latitude BETWEEN ? AND ? AND g.longitude BETWEEN ? AND ?)')
    matching_source = re.search(r'filters.add\("""(EXISTS \(SELECT 1 FROM sources.*?)"""\)', MEMORY, re.S).group(1)
    matching_source = matching_source.replace('${sourceFilter.first}', date_clause + scoped)
    args = ('01', 'Singapore', lat - .24, lat + .24, lon - .24, lon + .24)
    assert [row[0] for row in db.execute(f'SELECT id FROM images WHERE {matching_source} ORDER BY id', args)] == [1, 5, 6]

    run(db, body('private fun createVisualSearchIndex', 'private fun normalizeStoredEmbeddings'))
    db.execute("UPDATE images SET engine='eye', embedding=zeroblob(2048)")
    db.execute("UPDATE images SET decision='dismissed' WHERE id=6")
    db.execute("UPDATE sources SET source='picker' WHERE image_id=5")
    visual = body('private fun similarTo(', 'val rankedAt')
    visible = re.search(r'val filter = """(.*?)"""', visual, re.S).group(1)
    candidates = re.search(r'rawQuery\("""(SELECT id FROM images.*?)"""', visual, re.S).group(1)
    clause = re.search(r'val source = .*?"\$dates(.*?)"', filter_code).group(1)
    visual_sql = (candidates.replace('$filter', visible.replace('${sourceFilter.first}', date_clause + clause + scoped))
                  .replace('$sceneFilter', "AND images.kind = 'photo' AND images.category IS NULL"))
    assert list(db.execute(visual_sql, (0, -1, 'eye', args[0], 'gallery', *args[1:]))) == [(1,)]
    assert list(db.execute(visual_sql, (0, -1, 'eye', args[0], 'picker', *args[1:]))) == [(5,)]
    assert not list(db.execute(visual_sql, (0, 1, 'eye', args[0], 'gallery', *args[1:])))
    db.execute("UPDATE images SET kind='screenshot' WHERE id=5")
    assert not list(db.execute(visual_sql, (0, -1, 'eye', args[0], 'picker', *args[1:])))
    plan = db.execute('EXPLAIN QUERY PLAN ' + visual_sql, (0, -1, 'eye', args[0], 'gallery', *args[1:]))
    assert any('image_visual_candidates' in row[3] for row in plan)
    db.close()
    print('Singapore January source matching, visual candidate filters and index, and Qwen FTS upgrade verified')


def run_recall_ranking():
    db = connect(':memory:')
    run(db, body('override fun onCreate', 'override fun onUpgrade'))
    migrate(db)
    install_index(db)
    db.executemany("""INSERT INTO images(id, fingerprint, status, kind, tags, collection, analyzed)
        VALUES (?, ?, 'complete', 'photo', ?, ?, ?)""", [
        (1, 'exact-text', '[]', None, 1),
        (2, 'qwen', '[]', None, 2),
        (3, 'eye', '[{"label":"coastal_walk","confidence":0.9}]', None, 3),
        (4, 'saved-place', '[]', None, 4),
        (5, 'split-text', '[]', 'Walk', 5),
        (6, 'unrelated', '[]', 'Work', 6),
    ])
    db.executemany('INSERT INTO memory_details(image_id, ocr_text, qwen_tags, place) VALUES (?, ?, ?, ?)', [
        (1, 'a coastal\nwalk from yesterday', None, None),
        (2, None, '["coastal walk"]', None),
        (4, None, None, 'Coastal Walk'),
        (5, 'coastal map', None, None),
    ])
    recall = body('fun searchMemory(', 'private fun relatedRecallResults')
    sort = re.search(r'val sort = if .*?"""(CASE .*?END,)"""', recall, re.S).group(1)
    rows = db.execute(f"""SELECT images.id FROM memory_search JOIN images ON images.id = memory_search.docid
        LEFT JOIN memory_details details ON details.image_id = images.id WHERE memory_search MATCH ?
        ORDER BY {sort} images.analyzed DESC, images.id DESC""", ('"coastal" "walk"', *['coastal walk'] * 5))
    assert [row[0] for row in rows] == [1, 2, 3, 4, 5]
    db.close()
    print('Unified Recall ranks OCR, saved Qwen tags, Eye labels, metadata, and split matches')


if __name__ == '__main__':
    run_smoke()
    run_recall_location_and_tags()
    run_recall_ranking()
