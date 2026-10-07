"""Create the test label database (same schema as label_db_node) with five known places."""
import json, os, sqlite3, sys, uuid
db = sys.argv[1]
os.makedirs(os.path.dirname(db), exist_ok=True)
c = sqlite3.connect(db)
c.execute('''CREATE TABLE IF NOT EXISTS labels (
    label_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, aliases TEXT DEFAULT '[]',
    semantic_type TEXT DEFAULT 'other', geometry_type TEXT DEFAULT 'point_radius',
    geometry_x REAL DEFAULT 0.0, geometry_y REAL DEFAULT 0.0, geometry_radius REAL DEFAULT 1.0,
    geometry_polygon TEXT DEFAULT '[]', map_version TEXT DEFAULT '', created_at TEXT DEFAULT '')''')
if c.execute('SELECT COUNT(*) FROM labels').fetchone()[0] == 0:
    places = [('h1', [], 5.52, 6.36), ('h2', [], -9.78, -9.62), ('h3', [], -8.40, 9.24),
              ('h4', [], 15.94, -12.25), ('ash house', ['my house'], 2.09, -1.73)]
    for name, aliases, x, y in places:
        c.execute('INSERT INTO labels VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                  (str(uuid.uuid4()), name, json.dumps(aliases), 'house', 'point_radius', x, y, 1.5, '[]', '', ''))
    c.commit()
print('labels:', [r[0] for r in c.execute('SELECT display_name FROM labels')])
