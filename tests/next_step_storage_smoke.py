"""Verify additive follow-up storage and suggestion visibility using the shipped SQL."""
import re

from memory_smoke import install_index, source
from storage_smoke import MEMORY, body, connect, migrate, run


db = connect(":memory:")
run(db, body("override fun onCreate", "override fun onUpgrade"))
migrate(db)
install_index(db)
db.execute("""INSERT INTO images(id, fingerprint, status, kind, category)
    VALUES (1, 'receipt', 'complete', 'receipt', 'Receipts'),
           (2, 'product', 'complete', 'screenshot', 'Shopping references')""")
source(db, "content://receipt", 1, 100)
source(db, "content://product", 2, 200)
run(db, body("private fun createFollowUpSchema", "private fun createScanResults"))

query = re.search(r'fun nextStepRows.*?rawQuery\("""(.*?)"""', MEMORY, re.S).group(1)
kind = re.search(r'private val followUpKind = """(.*?)"""', MEMORY, re.S).group(1)
visible = re.search(r'private val visible = """(.*?)"""', MEMORY, re.S).group(1)
query = query.replace("$followUpKind", kind).replace("$visible", visible).replace("$where", "1=1").replace("$limit", "48")
assert [row[10] for row in db.execute(query)] == ["shopping", "receipt"]
ocr_target = re.search(r'fun shoppingOcrTarget.*?rawQuery\(\s*"""(.*?)"""', MEMORY, re.S).group(1)
ocr_target = ocr_target.replace("$followUpKind", kind).replace("$visible", visible)
assert db.execute(ocr_target, (2,)).fetchone() == ("product",)
assert db.execute(ocr_target, (1,)).fetchone() is None
db.execute("INSERT INTO photo_followups VALUES (1, 'scheduled', 1234)")
assert [row[9] for row in db.execute(query) if row[0] == 1] == [1234]
db.execute("UPDATE photo_followups SET state='done' WHERE image_id=1")
assert [row[0] for row in db.execute(query)] == [2]
db.execute("INSERT INTO archive VALUES('content://product', 'Photo', 'Camera', 10, '200', 1, 2, 0)")
assert not list(db.execute(query))
assert db.execute(ocr_target, (2,)).fetchone() is None
db.execute("DELETE FROM sources WHERE image_id=1")
db.execute("DELETE FROM images WHERE id=1")
assert not list(db.execute("SELECT * FROM photo_followups"))
print("Follow-up migration, state persistence, archive visibility, and cascade checks passed")
