import json
import sys
import time

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

MAX_NODES = 1500
MAX_DEPTH = 40
MAX_TEXT = 400
SIZE_TOLERANCE = 2
NOTABLE_STATES = {
    Atspi.StateType.FOCUSED: "focused",
    Atspi.StateType.SELECTED: "selected",
    Atspi.StateType.CHECKED: "checked",
    Atspi.StateType.PRESSED: "pressed",
    Atspi.StateType.EXPANDED: "expanded",
}


def clean_title(title):
    if title and "⠀" <= title[0] <= "⣿":
        return title[1:].lstrip()
    return title or ""


def safe(call, fallback):
    try:
        return call()
    except Exception:
        return fallback


def children(node):
    count = safe(node.get_child_count, 0)
    for index in range(count):
        child = safe(lambda: node.get_child_at_index(index), None)
        if child is not None:
            yield child


def window_size(window):
    extents = safe(lambda: window.get_extents(Atspi.CoordType.SCREEN), None)
    if extents is None:
        return None
    return (extents.width, extents.height)


def candidate_windows(pid):
    desktop = Atspi.get_desktop(0)
    by_pid = []
    everyone = []
    for app in children(desktop):
        windows = list(children(app))
        everyone.extend(windows)
        if safe(app.get_process_id, -1) == pid:
            by_pid.extend(windows)
    return by_pid, everyone


def size_matches(window, width, height):
    size = window_size(window)
    return (
        size is not None
        and abs(size[0] - width) <= SIZE_TOLERANCE
        and abs(size[1] - height) <= SIZE_TOLERANCE
    )


def pick_window(windows, title, width, height, allow_untitled):
    wanted = clean_title(title)
    titled = [w for w in windows if clean_title(safe(w.get_name, "")) == wanted]
    exact = [w for w in titled if size_matches(w, width, height)]
    if len(exact) == 1:
        return exact[0]
    if len(exact) == 0 and len(titled) == 1:
        return titled[0]
    if allow_untitled and len(exact) == 0 and len(titled) == 0:
        sized = [w for w in windows if size_matches(w, width, height)]
        if len(sized) == 1:
            return sized[0]
    return None


def node_text(node):
    if "Text" not in safe(node.get_interfaces, []):
        return ""
    count = safe(lambda: Atspi.Text.get_character_count(node), 0)
    if count <= 0:
        return ""
    value = safe(lambda: Atspi.Text.get_text(node, 0, min(count, MAX_TEXT)), "") or ""
    value = " ".join(value.replace("\ufffc", " ").split())
    if count > MAX_TEXT:
        value += "…"
    return value


def render(window, deadline):
    lines = []
    state = {"nodes": 0, "truncated": False}

    def visit(node, depth):
        if state["nodes"] >= MAX_NODES or time.monotonic() > deadline:
            state["truncated"] = True
            return
        if depth > MAX_DEPTH:
            state["truncated"] = True
            return
        states = safe(node.get_state_set, None)
        if depth > 0 and states is not None and not states.contains(
            Atspi.StateType.SHOWING
        ):
            return
        state["nodes"] += 1
        role = safe(node.get_role_name, "") or "unknown"
        name = " ".join((safe(node.get_name, "") or "").replace("\ufffc", " ").split())
        text = node_text(node)
        flags = [
            label
            for kind, label in NOTABLE_STATES.items()
            if states is not None and states.contains(kind)
        ]
        meaningful = depth == 0 or name or (text and text != name) or flags
        next_depth = depth
        if meaningful:
            line = "  " * depth + role
            if name:
                line += f' "{name}"'
            if text and text != name:
                line += f": {text}"
            if flags:
                line += f" [{', '.join(flags)}]"
            lines.append(line)
            next_depth = depth + 1
        for child in children(node):
            visit(child, next_depth)

    visit(window, 0)
    return "\n".join(lines), state["nodes"], state["truncated"]


def main():
    request = json.loads(sys.argv[1])
    deadline = time.monotonic() + float(request.get("budgetSeconds", 2.5))
    by_pid, everyone = candidate_windows(int(request["pid"]))
    window = pick_window(
        by_pid if by_pid else everyone,
        request["title"],
        int(request["width"]),
        int(request["height"]),
        allow_untitled=bool(by_pid),
    )
    if window is None:
        reason = "no-pid-windows" if not by_pid else "no-unique-match"
        print(json.dumps({"matched": False, "reason": reason}))
        return
    text, nodes, truncated = render(window, deadline)
    print(
        json.dumps(
            {"matched": True, "text": text, "nodes": nodes, "truncated": truncated}
        )
    )


main()
