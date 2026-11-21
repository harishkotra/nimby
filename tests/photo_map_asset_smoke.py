"""Check that Photo Map can load its style, tiles, and glyphs from bundled assets."""
import gzip
import hashlib
import json
import struct
from pathlib import Path

ASSETS = Path(__file__).resolve().parents[1] / 'modules/nimby-gallery/android/src/main/assets/photo-map'
archive = (ASSETS / 'world.pmtiles').read_bytes()
assert archive[:8] == b'PMTiles\x03'
assert archive[100:102] == bytes([0, 5])
assert hashlib.sha256(archive).hexdigest() == 'ba0e230859f961f29c724045e2a9dda1e6e4a67cca8e395edac8a67e17dce3c6'
meta_offset, meta_length = struct.unpack_from('<QQ', archive, 24)
metadata = json.loads(gzip.decompress(archive[meta_offset:meta_offset + meta_length]))
assert 'OpenStreetMap' in metadata['attribution']
assert {'earth', 'water', 'places', 'boundaries'} <= {x['id'] for x in metadata['vector_layers']}
style_text = (ASSETS / 'style.json').read_text()
style = json.loads(style_text)
assert style['sources']['world']['url'] == 'pmtiles://asset://photo-map/world.pmtiles'
assert 'https://' not in style_text and 'http://' not in style_text
assert (ASSETS / 'fonts/Noto Sans Regular/0-255.pbf').stat().st_size > 0
print('Photo Map PMTiles archive, attribution, and offline resource paths verified')
