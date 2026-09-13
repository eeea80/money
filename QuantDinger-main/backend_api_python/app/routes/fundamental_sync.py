"""Administrative fundamental preparation endpoints."""
from flask import jsonify, request, g

from app.routes.factors import factors_blp
from app.services.fundamental_sync import start_job, status_for, set_schedule
from app.services.fundamental_coverage import coverage_for
from app.utils.auth import login_required, admin_required


def invoke(fn):
    try:
        return jsonify(code=1, msg='success', data=fn())
    except ValueError as exc:
        return jsonify(code=0, msg=str(exc), data=None), 400


@factors_blp.route('/fundamentals/universe/<int:universe_id>', methods=['GET'])
@login_required
@admin_required
def universe_fundamentals(universe_id):
    raw_fields = request.args.get('fields')
    return invoke(lambda: dict(**status_for(g.user_id, universe_id), coverage=coverage_for(
        g.user_id, universe_id,
        raw_fields.split(',') if raw_fields else None, request.args.get('as_of'), request.args.get('mode'))))


@factors_blp.route('/fundamentals/universe/<int:universe_id>/sync', methods=['POST'])
@login_required
@admin_required
def sync_universe_fundamentals(universe_id):
    payload = request.get_json(silent=True) or {}
    return invoke(lambda: start_job(g.user_id, universe_id, payload.get('mode', 'history'),
                                   payload.get('fields'), payload.get('retry_job'), payload.get('incremental', True)))


@factors_blp.route('/fundamentals/universe/<int:universe_id>/schedule', methods=['POST'])
@login_required
@admin_required
def schedule_universe_fundamentals(universe_id):
    payload = request.get_json(silent=True) or {}
    return invoke(lambda: set_schedule(g.user_id, universe_id, payload.get('enabled'),
                                      payload.get('mode', 'history'), payload.get('fields')))
