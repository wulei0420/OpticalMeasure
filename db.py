"""OpticalMeasure V2.22 — SQLite database module."""
import sqlite3, os, json
from camera_utils import path

DB_PATH = path('om_data.db')

def _conn():
    os.makedirs(path('.'), exist_ok=True)
    return sqlite3.connect(DB_PATH)

def init():
    c = _conn()
    c.execute('''CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT ''
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        timestamp TEXT NOT NULL,
        pd REAL, rpd REAL, lpd REAL,
        right_ph REAL, left_ph REAL,
        frame_width REAL, frame_height REAL, bridge REAL,
        tilt_angle REAL, vertex_distance REAL,
        front_crop BLOB, side_crop BLOB,
        result_json TEXT DEFAULT '{}'
    )''')
    c.commit()
    c.close()

def create_customer(name, phone='', notes=''):
    import uuid, time
    cid = str(uuid.uuid4())[:8]
    now = time.strftime('%Y-%m-%d %H:%M')
    db = _conn()
    db.execute('INSERT INTO customers (id,name,phone,notes,created_at) VALUES (?,?,?,?,?)',
               [cid, name.strip(), (phone or '').strip(), (notes or '').strip(), now])
    db.commit()
    row = db.execute('SELECT * FROM customers WHERE id=?', [cid]).fetchone()
    db.close()
    return _customer_row(row)

def search_customers(query=''):
    db = _conn()
    if query:
        q = f'%{query}%'
        rows = db.execute('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY created_at DESC',
                          [q, q]).fetchall()
    else:
        rows = db.execute('SELECT * FROM customers ORDER BY created_at DESC').fetchall()
    db.close()
    return [_customer_row(r) for r in rows]

def _customer_row(row):
    if not row: return None
    db = _conn()
    cnt = db.execute('SELECT COUNT(*) FROM records WHERE customer_id=?', [row[0]]).fetchone()[0]
    db.close()
    return {'id': row[0], 'name': row[1], 'phone': row[2], 'notes': row[3],
            'created_at': row[4], 'records': cnt}

def get_customer(cid):
    db = _conn()
    row = db.execute('SELECT * FROM customers WHERE id=?', [cid]).fetchone()
    if not row:
        db.close()
        return None
    recs = db.execute('SELECT * FROM records WHERE customer_id=? ORDER BY timestamp DESC', [cid]).fetchall()
    db.close()
    c = _customer_row(row)
    c['records'] = [_record_summary(r) for r in recs]
    return c

def _record_summary(row):
    cols = ['id', 'customer_id', 'timestamp', 'pd', 'rpd', 'lpd', 'right_ph', 'left_ph',
            'frame_width', 'frame_height', 'bridge', 'tilt_angle', 'vertex_distance',
            'front_crop', 'side_crop', 'result_json']
    d = {}
    for i, k in enumerate(cols):
        if k in ('front_crop', 'side_crop'):
            continue
        d[k] = row[i]
    d['pd'] = d['pd'] or 0
    # Merge result_json contents for fields like front_points, side_points
    rj = row[15]  # result_json column
    if rj:
        try:
            extra = json.loads(rj)
            for ek in ('front_points', 'side_points'):
                if ek in extra: d[ek] = extra[ek]
        except: pass
    return d

def delete_customer(cid):
    db = _conn()
    db.execute('DELETE FROM records WHERE customer_id=?', [cid])
    db.execute('DELETE FROM customers WHERE id=?', [cid])
    db.commit()
    db.close()

def update_customer(cid, name=None, phone=None):
    db = _conn()
    if name is not None:
        db.execute('UPDATE customers SET name=? WHERE id=?', [name.strip(), cid])
    if phone is not None:
        db.execute('UPDATE customers SET phone=? WHERE id=?', [(phone or '').strip(), cid])
    db.commit()
    row = db.execute('SELECT * FROM customers WHERE id=?', [cid]).fetchone()
    db.close()
    return _customer_row(row)

def save_record(cid, ts, result, front_blob=None, side_blob=None):
    r = result or {}
    db = _conn()
    db.execute('''INSERT INTO records (customer_id,timestamp,pd,rpd,lpd,right_ph,left_ph,
        frame_width,frame_height,bridge,tilt_angle,vertex_distance,front_crop,side_crop,result_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', [
        cid, ts,
        r.get('pd'), r.get('rpd'), r.get('lpd'),
        r.get('right_ph'), r.get('left_ph'),
        r.get('width'), r.get('height'), r.get('bridge'),
        r.get('tilt_angle'), r.get('vertex_distance'),
        front_blob, side_blob,
        json.dumps(r, ensure_ascii=False)
    ])
    db.commit()
    db.close()

def get_record_image(cid, ts, img_type):
    col = 'front_crop' if img_type == 'front' else 'side_crop'
    db = _conn()
    row = db.execute(f'SELECT {col} FROM records WHERE customer_id=? AND timestamp=?', [cid, ts]).fetchone()
    db.close()
    return row[0] if row else None

def get_record(cid, ts):
    db = _conn()
    row = db.execute('SELECT * FROM records WHERE customer_id=? AND timestamp=?', [cid, ts]).fetchone()
    db.close()
    return _record_summary(row) if row else None

def delete_record(cid, ts):
    db = _conn()
    db.execute('DELETE FROM records WHERE customer_id=? AND timestamp=?', [cid, ts])
    db.commit()
    db.close()

# Auto-init on import
init()
