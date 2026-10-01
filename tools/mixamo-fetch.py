#!/usr/bin/env python3
"""Download the game's Mixamo characters and animations as FBX.

    MIXAMO_TOKEN=... python3 tools/mixamo-fetch.py            # everything missing
    MIXAMO_TOKEN=... python3 tools/mixamo-fetch.py ritter wolf # only these roles
    MIXAMO_TOKEN=... python3 tools/mixamo-fetch.py --check     # resolve ids, no export

The token is the bearer token of a logged-in mixamo.com session (DevTools →
Application → Local Storage → access_token). Each role gets one skinned FBX
(the mesh, posed with its idle) and skinless clips for the rest, so the mesh
and its textures are stored once. Files land in assets/mixamo/<role>/ and
existing ones are skipped, so the script can be re-run after a failure.

Exports are served from mixamo-storage-prod.s3-us-west-2.amazonaws.com, which
has to be reachable from wherever this runs.
"""
import json
import os
import sys
import time
import urllib.request

API = 'https://www.mixamo.com/api/v1'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'mixamo')

# Clip sets, shared by roles that move the same way. Locomotion is exported in
# place: the game moves the actor itself.
SWORD_SHIELD = {
    'idle': 'c9cc6f74-b96c-11e4-a802-0aaa78deedf9',     # Sword And Shield Idle
    'walk': 'c9cc467a-b96c-11e4-a802-0aaa78deedf9',     # Sword And Shield Walk
    'run': 'c9cc4740-b96c-11e4-a802-0aaa78deedf9',      # Sword And Shield Run
    'slash': 'c9cc50a3-b96c-11e4-a802-0aaa78deedf9',    # Slash Combo
    'power': 'c9cc522d-b96c-11e4-a802-0aaa78deedf9',    # Power Slash
    'block': 'c9cc53c2-b96c-11e4-a802-0aaa78deedf9',    # Block Idle
    'hit': 'c9cc5854-b96c-11e4-a802-0aaa78deedf9',      # Unblocked Impact
    'death': 'c9cc6aba-b96c-11e4-a802-0aaa78deedf9',    # Falling Back Death
}
BOW = {
    'idle': 'c9ceb236-b96c-11e4-a802-0aaa78deedf9',     # Standing Idle With Bow
    'walk': 'c9cec6ba-b96c-11e4-a802-0aaa78deedf9',     # Walking Forward With Bow
    'run': 'c9cec07a-b96c-11e4-a802-0aaa78deedf9',      # Running Forward With Bow
    'shoot': 'c9cebedc-b96c-11e4-a802-0aaa78deedf9',    # Standing Aim Fire Arrow
    'draw': 'c9ceacc6-b96c-11e4-a802-0aaa78deedf9',     # Reloading Bow
    'hit': 'c9cebe15-b96c-11e4-a802-0aaa78deedf9',      # Hit Reaction With Bow
    'death': 'c9ceaf01-b96c-11e4-a802-0aaa78deedf9',    # Death Falling Forwards With Bow
}
MAGIC = {
    'idle': '51e30f03-9fbf-4d0a-a1b4-489f94e85245',     # Playing With Magic
    'walk': '4d2adf5a-39fa-4aa1-9272-e07c334bc0a3',     # Walking Forwards
    'cast': 'a3d120fd-c26a-46c7-a4a0-59c1c5d8157c',     # 1H Magic Attack 01
    'cast2': 'd3a09098-c43e-49e7-85f3-fcc86760517a',    # 2H Magic Attack 01
    'area': '3a2c5c31-fe8a-4eb1-98c7-ad6cbb95b547',     # 2H Magic Area Attack 01
    'hit': 'b099a412-5194-4a60-850f-2306308fba1e',      # Small Hit Reaction
    'death': 'e13a58d8-0104-45a5-9837-03fc3c307632',    # Death Falling Backwards
}
UNDEAD = {
    'idle': 'c9cbd649-b96c-11e4-a802-0aaa78deedf9',     # Zombie Standing Idle
    'walk': 'c9cbd4d9-b96c-11e4-a802-0aaa78deedf9',     # Zombie Walking
    'attack': 'c9cbd7ad-b96c-11e4-a802-0aaa78deedf9',   # Zombie Swipe Attack
    'attack2': 'c9c713dd-b96c-11e4-a802-0aaa78deedf9',  # Zombie Overhead Attack
    'hit': 'c9c947d0-b96c-11e4-a802-0aaa78deedf9',      # Hit Reaction
    'death': 'c9cbda5a-b96c-11e4-a802-0aaa78deedf9',    # Zombie Death
}
BRUTE = {
    'idle': 'c9c93f13-b96c-11e4-a802-0aaa78deedf9',     # Mutant Breathing Idle
    'walk': 'c9c93a8c-b96c-11e4-a802-0aaa78deedf9',     # Mutant Walking
    'run': 'c9c93cdc-b96c-11e4-a802-0aaa78deedf9',      # Mutant Run
    'swipe': 'c9c93c1d-b96c-11e4-a802-0aaa78deedf9',    # Mutant Swiping
    'roar': 'c9ccb4c2-b96c-11e4-a802-0aaa78deedf9',     # Mutant Roaring
    'death': 'c9c93d98-b96c-11e4-a802-0aaa78deedf9',    # Mutant Dying
}
INPLACE = {'walk', 'run'}

# role id (as in src/game/content.js) -> (Mixamo character, clip set)
ROLES = {
    'ritter': ('9669a5a9-964e-4060-85f0-d052a592e0e4', SWORD_SHIELD),  # Paladin W/Prop J Nordstrom
    'jaegerin': ('90484e3f-d8be-410f-a3ec-96977f84c2d9', BOW),         # Erika Archer With Bow/Arrow
    'hexer': ('dc527621-d14a-41f6-aa74-dbdb20dbf017', MAGIC),          # Ganfaul M Aure
    'skeleton': ('91d02eaa-1b0a-4d34-b859-01bcd092c713', UNDEAD),      # Skeletonzombie T Avelange
    'drowned': ('3576fd60-beef-49ec-a3d0-f93231f4fc29', UNDEAD),       # Warzombie F Pedroso
    'raider': ('5fb4b535-034a-4011-af3b-2880391547a5', SWORD_SHIELD),  # Peasant Man
    'laume': ('b6d6b787-7378-4316-8db9-0434e51a44b4', MAGIC),          # Nightshade J Friedrich
    'wolfsvater': ('cccc84b6-d072-4972-99da-75c5702e25f6', BRUTE),     # Mutant
    'bernsteinfresser': ('c5ab0438-6309-40a5-bd0c-73ab2e23ecf1', BRUTE),  # Maw J Laygo
    'hochmeister': ('f57c2597-1a49-4c13-a6a5-1cf29532b9d7', SWORD_SHIELD),  # Knight D Pelegrini
    'perkunas': ('efb06b46-a470-49b2-b7da-a06755d4dba7', BRUTE),       # Warrok W Kurniawan
}


def call(path, body=None):
    headers = {'Authorization': 'Bearer ' + os.environ['MIXAMO_TOKEN'], 'X-Api-Key': 'mixamo2',
               'Accept': 'application/json', 'Content-Type': 'application/json'}
    data = None if body is None else json.dumps(body).encode()
    with urllib.request.urlopen(urllib.request.Request(API + path, data, headers), timeout=60) as r:
        return json.loads(r.read() or b'{}')


def gms_hash(char_id, anim_id, inplace):
    d = call(f'/products/{anim_id}?similar=0&character_id={char_id}')
    g = d['details']['gms_hash']
    g = dict(g, params=','.join(str(p[1]) for p in g.get('params', [])))
    if 'inplace' in g:
        g['inplace'] = inplace
    return g, d['name']


def export(char_id, anim_id, path, skin, inplace):
    g, name = gms_hash(char_id, anim_id, inplace)
    call('/animations/export', {
        'character_id': char_id, 'gms_hash': [g], 'product_name': name, 'type': 'Motion',
        'preferences': {'format': 'fbx7_2019', 'skin': str(skin).lower(), 'fps': '30', 'reducekf': '0'},
    })
    for _ in range(200):
        time.sleep(3)
        m = call(f'/characters/{char_id}/monitor')
        if m.get('status') == 'completed':
            tmp = path + '.part'
            urllib.request.urlretrieve(m['job_result'], tmp)
            os.replace(tmp, path)
            return
        if m.get('status') == 'failed':
            raise RuntimeError(f'{path}: {m.get("message") or m}')
    raise TimeoutError(path)


def main(argv):
    check = '--check' in argv
    roles = [a for a in argv if not a.startswith('--')] or list(ROLES)
    for role in roles:
        char_id, clips = ROLES[role]
        for i, (clip, anim_id) in enumerate(clips.items()):
            skin = i == 0
            path = os.path.join(OUT, role, f'{role}.fbx' if skin else f'{clip}.fbx')
            if check:
                gms_hash(char_id, anim_id, clip in INPLACE)
                print('ok  ', os.path.relpath(path, OUT))
                continue
            if os.path.exists(path):
                continue
            os.makedirs(os.path.dirname(path), exist_ok=True)
            export(char_id, anim_id, path, skin, clip in INPLACE)
            print(f'{os.path.getsize(path) / 1e6:6.1f} MB  {os.path.relpath(path, OUT)}')


if __name__ == '__main__':
    main(sys.argv[1:])
