"""Customer CRUD routes."""
import base64
from datetime import datetime
from flask import jsonify, Response, request

import db
from src.modules.customer import bp


@bp.route('/api/customers', methods=['GET', 'POST'])
def customers_api():
    if request.method == 'POST':
        data = request.json or {}
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'error': 'name required'}), 400
        c = db.create_customer(name, data.get('phone', ''), data.get('notes', ''))
        return jsonify(c)
    q = (request.args.get('q') or '').strip()
    return jsonify(db.search_customers(q))


@bp.route('/api/customers/<cid>', methods=['GET', 'DELETE', 'PUT'])
def customer_detail(cid):
    if request.method == 'DELETE':
        db.delete_customer(cid)
        return jsonify({'ok': True})
    if request.method == 'PUT':
        data = request.json or {}
        c = db.update_customer(cid, data.get('name'), data.get('phone'))
        return jsonify(c) if c else (jsonify({'error': 'not found'}), 404)
    c = db.get_customer(cid)
    return jsonify(c) if c else (jsonify({'error': 'not found'}), 404)


@bp.route('/api/customers/<cid>/records', methods=['POST'])
def customer_save_record(cid):
    data = request.json or {}
    ts = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    result = data.get('result', {})
    front_blob = side_blob = None
    for key, name in [('front_crop', 'front'), ('side_crop', 'side')]:
        b64 = data.get(f'{name}_crop', '')
        if b64 and ',' in b64:
            raw = base64.b64decode(b64.split(',', 1)[1])
            if name == 'front':
                front_blob = raw
            else:
                side_blob = raw
    db.save_record(cid, ts, result, front_blob, side_blob)
    return jsonify({'ok': True, 'timestamp': ts})


@bp.route('/api/customers/<cid>/records/<rid>', methods=['GET', 'DELETE'])
def customer_record(cid, rid):
    if request.method == 'DELETE':
        db.delete_record(cid, rid)
        return jsonify({'ok': True})
    r = db.get_record(cid, rid)
    if not r:
        return jsonify({'error': 'not found'}), 404
    r['timestamp'] = rid
    return jsonify(r)


@bp.route('/api/customers/<cid>/records/<rid>/image/<img_type>')
def customer_record_image(cid, rid, img_type):
    blob = db.get_record_image(cid, rid, img_type)
    if not blob:
        return 'No image', 404
    return Response(blob, mimetype='image/png')
