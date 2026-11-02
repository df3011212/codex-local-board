"""Shared schema and bounded, atomic local checkpoint storage. Stdlib only."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
import time

ROOT = Path(__file__).resolve().parent
MAX_STATE_BYTES = 262144
MAX_CONFIG_BYTES = 16384
MAX_PROJECTS, MAX_TASKS, MAX_AGENTS, MAX_EVENTS = 20, 200, 32, 30
STATUSES = ('not_started', 'pending', 'in_progress', 'source_ready', 'passed', 'done', 'frozen', 'blocked')
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z')


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def text(value, field, maximum=1200):
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError(f'{field}: expected text, maximum {maximum} characters')
    if any(ord(char) < 32 and char not in '\n\t' for char in value):
        raise ValueError(f'{field}: unsupported control character')
    return value


def identity(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError('ID must use 1–64 ASCII letters, digits, underscores or hyphens')
    return value


def rows(value, maximum, field):
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f'{field}: expected at most {maximum} entries')
    return value


def keys(value, allowed, required=()):
    if not isinstance(value, dict) or set(value)-set(allowed) or set(required)-set(value):
        raise ValueError('Unexpected or missing schema fields')


def named_rows(values, maximum, allowed, required):
    seen = set()
    for row in rows(values, maximum, 'rows'):
        keys(row, allowed, required)
        identifier = identity(row['id'])
        if identifier in seen:
            raise ValueError('Duplicate ID')
        seen.add(identifier)
        yield row


def timestamp(value):
    if value is not None:
        text(value, 'updated_at', 40)
        datetime.fromisoformat(value.replace('Z', '+00:00'))


def validate_state(state):
    keys(state, ('schema_version', 'updated_at', 'demo', 'projects'), ('schema_version', 'projects'))
    if type(state['schema_version']) is not int or state['schema_version'] != 1:
        raise ValueError('Unsupported state schema version')
    if type(state.get('demo', False)) is not bool:
        raise ValueError('demo must be true or false')
    timestamp(state.get('updated_at'))
    for project in named_rows(state['projects'], MAX_PROJECTS, ('id', 'title', 'phase', 'summary', 'groups', 'tasks', 'agents', 'events'), ('id', 'title', 'groups', 'tasks', 'agents', 'events')):
        text(project['title'], 'title', 120)
        text(project.get('phase', ''), 'phase', 120)
        text(project.get('summary', ''), 'summary')
        groups = set()
        for group in named_rows(project['groups'], 12, ('id', 'title'), ('id', 'title')):
            text(group['title'], 'group title', 120)
            groups.add(group['id'])
        if not groups:
            raise ValueError('Each project needs at least one group')
        for task in named_rows(project['tasks'], MAX_TASKS, ('id', 'title', 'group', 'status', 'detail'), ('id', 'title', 'group', 'status')):
            text(task['title'], 'task title', 180)
            text(task.get('detail', ''), 'task detail')
            if task['group'] not in groups or task['status'] not in STATUSES:
                raise ValueError('Unknown task group or status')
        for agent in named_rows(project['agents'], MAX_AGENTS, ('id', 'role', 'status', 'detail'), ('id', 'role', 'status')):
            text(agent['role'], 'role', 120)
            text(agent.get('detail', ''), 'agent detail')
            if agent['status'] not in STATUSES:
                raise ValueError('Unknown agent status')
        for event in rows(project['events'], MAX_EVENTS, 'events'):
            keys(event, ('at', 'text'), ('at', 'text'))
            timestamp(event['at'])
            text(event['text'], 'event', 1000)
    return state


def validate_config(config):
    keys(config, ('schema_version', 'title', 'subtitle', 'poll_seconds', 'complete_statuses', 'show_agents', 'show_events'), ('schema_version', 'title', 'subtitle', 'poll_seconds', 'complete_statuses', 'show_agents', 'show_events'))
    if type(config['schema_version']) is not int or config['schema_version'] != 1:
        raise ValueError('Unsupported config schema version')
    text(config['title'], 'title', 120)
    text(config['subtitle'], 'subtitle', 300)
    if type(config['poll_seconds']) is not int or not 1 <= config['poll_seconds'] <= 60:
        raise ValueError('poll_seconds must be 1–60')
    complete = rows(config['complete_statuses'], len(STATUSES), 'complete_statuses')
    if not complete or any(s not in ('done', 'passed', 'frozen', 'source_ready') for s in complete) or len(set(complete)) != len(complete):
        raise ValueError('Invalid explicit completion statuses')
    if any(type(config[k]) is not bool for k in ('show_agents', 'show_events')):
        raise ValueError('Display switches must be boolean')
    return config


def read_document(path, limit, validator):
    with Path(path).open('rb') as stream:
        raw = stream.read(limit+1)
    if len(raw) > limit:
        raise ValueError('Document exceeds the size limit')
    return validator(json.loads(raw.decode('utf-8-sig')))


def encode_document(value, limit, validator):
    validator(value)
    raw = (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode('utf-8')
    if len(raw) > limit:
        raise ValueError('Document exceeds the size limit')
    return raw


def atomic_write(path, value, limit=MAX_STATE_BYTES, validator=validate_state):
    path = Path(path)
    raw = encode_document(value, limit, validator)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.'+path.name+'.', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


@contextmanager
def state_lock(path, timeout=5):
    """Serialize cooperating CLI writers. OS releases the lock after a crash."""
    lock_path = Path(path).with_name('.'+Path(path).name+'.lock')
    with lock_path.open('a+b') as stream:
        stream.seek(0, os.SEEK_END)
        if stream.tell() == 0:
            stream.write(b'0'); stream.flush()
        deadline = time.monotonic()+timeout
        while True:
            try:
                stream.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError('Another checkpoint writer is busy') from None
                time.sleep(0.05)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
