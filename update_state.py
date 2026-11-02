"""Explicit local checkpoint CLI. Does not inspect conversations or Codex logs."""
import argparse
from pathlib import Path

from board import (ROOT, MAX_CONFIG_BYTES, MAX_STATE_BYTES, MAX_EVENTS, STATUSES,
                   atomic_write, now, read_document, state_lock, validate_config, validate_state)


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--state', type=Path, default=ROOT/'state.json')
    p.add_argument('--config', type=Path, default=ROOT/'config.json')
    commands = p.add_subparsers(dest='command', required=True)
    commands.add_parser('init', help='Create only missing files from clean examples')
    for name in ('add-project', 'set-project'):
        sub = commands.add_parser(name)
        sub.add_argument('--id', required=True)
        sub.add_argument('--title', required=name == 'add-project')
        sub.add_argument('--phase')
        sub.add_argument('--summary')
    for name in ('add-task', 'set-task'):
        sub = commands.add_parser(name)
        sub.add_argument('--project', required=True)
        sub.add_argument('--id', required=True)
        sub.add_argument('--title', required=name == 'add-task')
        sub.add_argument('--group', default='delivery' if name == 'add-task' else None)
        sub.add_argument('--status', choices=STATUSES, default='pending' if name == 'add-task' else None)
        sub.add_argument('--detail')
    sub = commands.add_parser('set-agent')
    sub.add_argument('--project', required=True)
    sub.add_argument('--id', required=True)
    sub.add_argument('--role')
    sub.add_argument('--status', choices=STATUSES)
    sub.add_argument('--detail')
    sub = commands.add_parser('event')
    sub.add_argument('--project', required=True)
    sub.add_argument('--text', required=True)
    return p


def update(args):
    path = args.state
    with state_lock(path):
        if args.command == 'init':
            if not path.exists():
                atomic_write(path, read_document(ROOT/'state.example.json', MAX_STATE_BYTES, validate_state))
            if not args.config.exists():
                atomic_write(args.config, read_document(ROOT/'config.example.json', MAX_CONFIG_BYTES, validate_config), MAX_CONFIG_BYTES, validate_config)
            return
        state = read_document(path, MAX_STATE_BYTES, validate_state)
        if args.command == 'add-project':
            if any(p['id'] == args.id for p in state['projects']):
                raise ValueError('Project ID already exists')
            state['projects'].append({'id': args.id, 'title': args.title, 'phase': args.phase or '', 'summary': args.summary or '', 'groups': [{'id': 'delivery', 'title': '交付關卡'}, {'id': 'ui', 'title': '介面關卡'}], 'tasks': [], 'agents': [], 'events': []})
        else:
            project_id = args.id if args.command == 'set-project' else args.project
            project = next((p for p in state['projects'] if p['id'] == project_id), None)
            if project is None:
                raise ValueError('Unknown project ID')
            if args.command == 'set-project':
                for key in ('title', 'phase', 'summary'):
                    if getattr(args, key) is not None:
                        project[key] = getattr(args, key)
            elif args.command in ('add-task', 'set-task'):
                task = next((t for t in project['tasks'] if t['id'] == args.id), None)
                if args.command == 'add-task':
                    if task is not None:
                        raise ValueError('Task ID already exists')
                    task = {'id': args.id, 'title': args.title, 'group': args.group, 'status': args.status, 'detail': args.detail or ''}
                    project['tasks'].append(task)
                elif task is None:
                    raise ValueError('Unknown task ID')
                else:
                    for key in ('title', 'group', 'status', 'detail'):
                        if getattr(args, key) is not None:
                            task[key] = getattr(args, key)
            elif args.command == 'set-agent':
                agent = next((a for a in project['agents'] if a['id'] == args.id), None)
                if agent is None:
                    if not args.role:
                        raise ValueError('A new agent needs --role')
                    agent = {'id': args.id, 'role': args.role, 'status': args.status or 'pending', 'detail': args.detail or ''}
                    project['agents'].append(agent)
                else:
                    for key in ('role', 'status', 'detail'):
                        if getattr(args, key) is not None:
                            agent[key] = getattr(args, key)
            elif args.command == 'event':
                project['events'] = (project['events']+[{'at': now(), 'text': args.text}])[-MAX_EVENTS:]
        state['updated_at'] = now()
        state['demo'] = False
        atomic_write(path, state)


def main():
    p = parser()
    args = p.parse_args()
    try:
        update(args)
    except (OSError, ValueError, TypeError, UnicodeError, TimeoutError) as error:
        p.error(str(error))
    print('Local checkpoint saved.' if args.command != 'init' else 'Missing local files initialized; existing files preserved.')


if __name__ == '__main__':
    main()
