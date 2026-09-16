"""What a markerless tracker sees of a grapple, measured against the truth.

Reads a rig.json written by rig.mjs: N shots of one paired pose with the exact
view-projection matrix of each, plus the true world position of every joint of
both fighters. Runs mediapipe's pose landmarker on the pictures, triangulates
across views, and prints how far the answer is from what the renderer knew.

    python bjj/tools/mocap/see.py out/ [--model heavy] [--verify] [--cams 8]

--verify draws the *projected truth* on every frame and stops. Nothing below it
means anything until those dots sit on the joints: a measurement that has not
measured itself is a guess with decimal places.
"""
import json
import sys
import os
import numpy as np
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision

HERE = os.path.dirname(os.path.abspath(__file__))

# mediapipe landmark -> this rig's bone. A bone's world matrix holds its own
# head, so foreL is the elbow and handL the wrist.
LM = {
    11: 'armL', 12: 'armR', 13: 'foreL', 14: 'foreR', 15: 'handL', 16: 'handR',
    23: 'thighL', 24: 'thighR', 25: 'shinL', 26: 'shinR', 27: 'footL', 28: 'footR',
}
NAMES = list(LM.values())


def rows(vp):
    """The four rows of a column-major 4x4 as world->clip functionals."""
    m = np.array(vp, dtype=np.float64)
    return np.array([[m[0], m[4], m[8], m[12]],
                     [m[1], m[5], m[9], m[13]],
                     [m[2], m[6], m[10], m[14]],
                     [m[3], m[7], m[11], m[15]]])


def project(vp, p, w, h):
    r = rows(vp)
    X = np.array([p[0], p[1], p[2], 1.0])
    cw = r[3] @ X
    if cw <= 1e-6:
        return None
    nx, ny = (r[0] @ X) / cw, (r[1] @ X) / cw
    return ((nx * 0.5 + 0.5) * w, (1.0 - (ny * 0.5 + 0.5)) * h)


def _lsq(views):
    A, b = [], []
    for vp, nx, ny, wgt in views:
        r = rows(vp)
        for e in (nx * r[3] - r[0], ny * r[3] - r[1]):
            A.append(e[:3] * wgt)
            b.append(-e[3] * wgt)
    if len(A) < 4:
        return None
    x, *_ = np.linalg.lstsq(np.array(A), np.array(b), rcond=None)
    return x


def _reproj(vp, X):
    r = rows(vp)
    H = np.array([X[0], X[1], X[2], 1.0])
    cw = r[3] @ H
    if cw <= 1e-6:
        return None
    return ((r[0] @ H) / cw, (r[1] @ H) / cw)


def triangulate(views, tol=0.06):
    """Robust: the largest set of views that agree, refitted on that set.

    Plain least squares over every view was the first version and it measured
    the wrong thing. One view where the tracker put a knee on the other man
    drags the answer metres away, and the eight- and twelve-camera runs came
    back three times worse than the four-camera one — which cannot be a fact
    about cameras. Every real pipeline votes before it fits; so does this.

    `tol` is in normalised device units, so 0.06 is three per cent of the
    frame either way.
    """
    n = len(views)
    if n < 2:
        return None
    best = None
    for i in range(n):
        for j in range(i + 1, n):
            X = _lsq([views[i], views[j]])
            if X is None:
                continue
            keep = []
            for k, v in enumerate(views):
                uv = _reproj(v[0], X)
                if uv is None:
                    continue
                if abs(uv[0] - v[1]) < tol and abs(uv[1] - v[2]) < tol:
                    keep.append(k)
            if best is None or len(keep) > len(best):
                best = keep
    if best is None or len(best) < 2:
        return None
    return _lsq([views[k] for k in best])


def main():
    root = sys.argv[1].rstrip('/')
    rig = json.load(open(f'{root}/rig.json'))
    model = 'heavy'
    if '--model' in sys.argv:
        model = sys.argv[sys.argv.index('--model') + 1]
    ncams = int(sys.argv[sys.argv.index('--cams') + 1]) if '--cams' in sys.argv else len(rig['shots'])
    shots = rig['shots'][:ncams]
    truth = rig['truth']

    if '--verify' in sys.argv:
        for s in shots:
            img = cv2.imread(f"{root}/{s['name']}.png")
            for role, colour in (('A', (0, 255, 0)), ('B', (0, 128, 255))):
                for n in NAMES:
                    uv = project(s['vp'], truth[role][n], s['w'], s['h'])
                    if uv:
                        cv2.circle(img, (int(uv[0]), int(uv[1])), 4, colour, -1)
            cv2.imwrite(f"{root}/{s['name']}-truth.png", img)
        print(f'drew projected truth on {len(shots)} frames')
        return

    opts = vision.PoseLandmarkerOptions(
        base_options=mpp.BaseOptions(model_asset_path=f'{HERE}/pose_landmarker_{model}.task'),
        running_mode=vision.RunningMode.IMAGE,
        num_poses=4,
        min_pose_detection_confidence=0.2,
        min_pose_presence_confidence=0.2,
    )
    seen = {}          # name -> list of detections, each {lm: [(nx,ny,vis)]}
    with vision.PoseLandmarker.create_from_options(opts) as lmk:
        for s in shots:
            mpimg = mp.Image.create_from_file(f"{root}/{s['name']}.png")
            res = lmk.detect(mpimg)
            seen[s['name']] = [
                [(p[i].x, p[i].y, p[i].visibility) for i in range(33)]
                for p in res.pose_landmarks
            ]

    # Which detection is which fighter: the one whose projected truth it sits
    # closest to. This is knowledge a real shoot does not have, and it is given
    # away on purpose — the question here is whether the joints are *visible*,
    # not whether two people can be told apart.
    #
    # One detection may stand for one fighter and no more. The first version let
    # both roles claim the same blob, and on the four frames where the tracker
    # found one person instead of two it quietly scored B against A's skeleton:
    # B came out three times worse than A on every joint, which is not what
    # occlusion looks like. A miss has to be recorded as a miss.
    LIMIT = 0.18          # of the frame's diagonal; past this it is not that man
    picked = {}
    for s in shots:
        dets = seen[s['name']]
        diag = (s['w'] ** 2 + s['h'] ** 2) ** 0.5
        cost = {}
        for role in ('A', 'B'):
            proj = {n: project(s['vp'], truth[role][n], s['w'], s['h']) for n in NAMES}
            for j, d in enumerate(dets):
                tot, cnt = 0.0, 0
                for i, n in LM.items():
                    if proj[n] is None:
                        continue
                    u, v = d[i][0] * s['w'], d[i][1] * s['h']
                    tot += ((u - proj[n][0]) ** 2 + (v - proj[n][1]) ** 2) ** 0.5
                    cnt += 1
                if cnt:
                    cost[(role, j)] = tot / cnt
        picked[s['name']] = {'A': (None, None), 'B': (None, None)}
        taken = set()
        for (role, j), c in sorted(cost.items(), key=lambda kv: kv[1]):
            if j in taken or picked[s['name']][role][0] is not None:
                continue
            if c > LIMIT * diag:
                continue
            picked[s['name']][role] = (dets[j], c)
            taken.add(j)

    if '--draw' in sys.argv:
        for s in shots:
            img = cv2.imread(f"{root}/{s['name']}.png")
            for role, colour in (('A', (0, 255, 0)), ('B', (0, 128, 255))):
                for n in NAMES:
                    uv = project(s['vp'], truth[role][n], s['w'], s['h'])
                    if uv:
                        cv2.circle(img, (int(uv[0]), int(uv[1])), 5, colour, 1)
                d, _ = picked[s['name']][role]
                if d is None:
                    continue
                for i in LM:
                    cv2.circle(img, (int(d[i][0] * s['w']), int(d[i][1] * s['h'])), 3, colour, -1)
            cv2.imwrite(f"{root}/{s['name']}-seen.png", img)
        print(f'drew truth (rings) and tracker (dots) on {len(shots)} frames')

    print(f"pose {rig['pose']}   {len(shots)} cameras   model {model}")
    miss = sum(1 for s in shots for r in ('A', 'B') if picked[s['name']][r][0] is None)
    print(f"fighters the tracker never found: {miss} of {2*len(shots)} "
          f"(frame, fighter) pairs")
    print(f"detections per frame: " +
          ' '.join(str(len(seen[s['name']])) for s in shots))

    # Per-view 2D error first: if the tracker cannot find a joint in a picture,
    # no amount of triangulation invents it.
    px = []
    for s in shots:
        for role in ('A', 'B'):
            d, _ = picked[s['name']][role]
            if d is None:
                continue
            for i, n in LM.items():
                uv = project(s['vp'], truth[role][n], s['w'], s['h'])
                if uv is None:
                    continue
                px.append((((d[i][0] * s['w'] - uv[0]) ** 2 +
                            (d[i][1] * s['h'] - uv[1]) ** 2) ** 0.5, d[i][2]))
    px = np.array(px)
    if len(px):
        print(f"2D: median {np.median(px[:,0]):5.1f} px, "
              f"{100*np.mean(px[:,0] < 20):4.0f}% within 20 px, "
              f"mean reported visibility {np.mean(px[:,1]):.2f}")

    # Then 3D.
    print()
    print(f"{'joint':10} {'A cm':>7} {'B cm':>7}   views")
    err = {'A': [], 'B': []}
    for n in NAMES:
        line = [n]
        seenc = []
        for role in ('A', 'B'):
            vs = []
            for s in shots:
                d, _ = picked[s['name']][role]
                if d is None:
                    continue
                i = [k for k, v in LM.items() if v == n][0]
                vis = d[i][2]
                if vis < 0.5:
                    continue
                nx = d[i][0] * 2 - 1
                ny = 1 - d[i][1] * 2
                vs.append((s['vp'], nx, ny, vis))
            X = triangulate(vs)
            if X is None:
                line.append('    --')
                seenc.append(len(vs))
                continue
            e = float(np.linalg.norm(X - np.array(truth[role][n]))) * 100
            err[role].append(e)
            line.append(f'{e:6.1f}')
            seenc.append(len(vs))
        print(f'{line[0]:10} {line[1]:>7} {line[2]:>7}   {seenc[0]}/{seenc[1]}')
    for role in ('A', 'B'):
        if err[role]:
            a = np.array(err[role])
            print(f'{role}: median {np.median(a):.1f} cm, worst {a.max():.1f} cm, '
                  f'{len(a)}/{len(NAMES)} joints recovered')
        else:
            print(f'{role}: nothing recovered')


main()
