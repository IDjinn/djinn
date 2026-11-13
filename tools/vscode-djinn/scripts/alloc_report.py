import argparse
import bisect
import re
import subprocess
import sys

HEADER = re.compile(r"^\s*(\d+)\s+probe_[^:]+:(\w+):\s+\(([0-9a-f]+)(?: <- ([0-9a-f]+))?\)\s*(.*)$")
FRAME = re.compile(r"^\s+([0-9a-f]+)\s+(.+?)(?:\+0x([0-9a-f]+))?\s*$")
ARGUMENT = re.compile(r"(\w+)=(0x[0-9a-f]+)")
OBJDUMP_SYMBOL = re.compile(r"^([0-9a-f]+) <(.+)>:$")
OBJDUMP_INSTRUCTION = re.compile(r"^\s+([0-9a-f]+):\s")

PROBED = {"a_alloc": "__djinn_alloc", "a_zero": "__djinn_alloc_zeroed", "a_realloc": "__djinn_realloc"}
OPERATION = {"a_alloc": "alloc", "a_zero": "zeroed alloc", "a_realloc": "realloc"}


def read_disassembly(path):
    symbols = {}
    instructions = []
    with open(path, errors="replace") as stream:
        for line in stream:
            symbol = OBJDUMP_SYMBOL.match(line)
            if symbol:
                symbols[symbol.group(2)] = int(symbol.group(1), 16)
                continue
            instruction = OBJDUMP_INSTRUCTION.match(line)
            if instruction:
                instructions.append(int(instruction.group(1), 16))
    instructions.sort()
    return symbols, instructions


def blocks(stream):
    block = []
    for line in stream:
        line = line.rstrip("\n")
        if HEADER.match(line):
            if block:
                yield block
            block = [line]
        elif line.strip() and block:
            block.append(line)
    if block:
        yield block


def parse_frames(rows):
    frames = []
    for row in rows:
        if row.rstrip().endswith("(inlined)"):
            continue
        match = FRAME.match(row)
        if not match:
            continue
        address = int(match.group(1), 16)
        if address == 0:
            continue
        offset = int(match.group(3), 16) if match.group(3) else None
        frames.append((address, match.group(2), offset))
    return frames


def resolve_sources(binary, addresses):
    result = {}
    if not addresses:
        return result
    ordered = sorted(addresses)
    process = subprocess.run(
        ["addr2line", "-a", "-i", "-f", "-e", binary],
        input="\n".join(f"0x{value:x}" for value in ordered) + "\n",
        capture_output=True,
        text=True,
    )
    current = None
    pending = None
    for line in process.stdout.split("\n"):
        if re.fullmatch(r"0x[0-9a-f]+", line):
            current = int(line, 16)
            result[current] = []
            pending = None
        elif current is not None and line:
            if pending is None:
                pending = line
            else:
                location = re.sub(r" \(discriminator \d+\)$", "", line)
                file, _, number = location.rpartition(":")
                result[current].append((pending, file, int(number) if number.isdigit() else 0))
                pending = None
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--disassembly", required=True)
    arguments = parser.parse_args()

    symbols, instructions = read_disassembly(arguments.disassembly)
    base = None

    pending = {}
    live = {}
    records = []
    stacks = {}
    stack_info = []
    sequence = 0
    live_total = 0
    peak_total = 0
    peak_sequence = 0

    for block in blocks(sys.stdin):
        header = HEADER.match(block[0])
        if not header:
            continue
        thread = header.group(1)
        name = header.group(2)
        is_return = name.endswith("__return")
        kind = name[: -len("_r__return")] if is_return else name
        values = {key: int(value, 16) for key, value in ARGUMENT.findall(header.group(5))}

        if kind == "a_free":
            pointer = values.get("ptr", 0)
            index = live.pop(pointer, None)
            if index is not None:
                sequence += 1
                records[index][3] = sequence
                live_total -= records[index][1]
            continue

        if not is_return:
            if base is None and kind in PROBED and PROBED[kind] in symbols:
                base = int(header.group(3), 16) - symbols[PROBED[kind]]
            pending.setdefault(thread, []).append((kind, values.get("size", 0), values.get("old", 0)))
            continue

        stack = pending.get(thread)
        if not stack:
            continue
        entry_kind, size, old = stack.pop()
        pointer = values.get("ptr", 0)
        if base is None:
            continue
        sequence += 1
        if entry_kind == "a_realloc" and old != 0:
            old_index = live.pop(old, None)
            if old_index is not None:
                records[old_index][3] = sequence
                live_total -= records[old_index][1]
        if pointer == 0:
            continue

        frames = []
        for address, symbol, offset in parse_frames(block[1:]):
            static = address - base
            position = bisect.bisect_left(instructions, static) - 1
            call = instructions[position] if position >= 0 and 0 < static - instructions[position] < 16 else static
            adjusted = offset - (static - call) if offset is not None else None
            frames.append((call, symbol, adjusted))
        key = tuple(frames)
        identifier = stacks.get(key)
        if identifier is None:
            identifier = len(stack_info)
            stacks[key] = identifier
            stack_info.append({"frames": frames, "operation": OPERATION.get(entry_kind, "alloc"), "bytes": 0, "count": 0})
        stack_info[identifier]["bytes"] += size
        stack_info[identifier]["count"] += 1
        records.append([identifier, size, sequence, float("inf")])
        live[pointer] = len(records) - 1
        live_total += size
        if live_total > peak_total:
            peak_total = live_total
            peak_sequence = sequence

    live_end = [0] * len(stack_info)
    live_peak = [0] * len(stack_info)
    for identifier, size, allocated, freed in records:
        if freed == float("inf"):
            live_end[identifier] += size
        if allocated <= peak_sequence < freed:
            live_peak[identifier] += size

    addresses = {frame[0] for info in stack_info for frame in info["frames"]}
    sources = resolve_sources(arguments.binary, addresses)

    out = sys.stdout
    out.write(f"#summary peak={peak_total} live={live_total} allocations={len(records)}\n\n")
    for identifier, info in enumerate(stack_info):
        out.write(
            f"#alloc={info['bytes']} #count={info['count']} #live={live_end[identifier]} "
            f"#peak={live_peak[identifier]} #op={info['operation']}\n"
        )
        for call, symbol, offset in info["frames"]:
            levels = sources.get(call, [])
            runtime = (base or 0) + call
            suffix = f"+0x{offset:x}" if offset is not None else ""
            if not levels:
                out.write(f"\t    {runtime:x} {symbol}{suffix}\n")
                continue
            for position, (function, file, line) in enumerate(levels):
                outermost = position == len(levels) - 1
                out.write(f"\t    {runtime:x} {symbol if outermost else function}{suffix}\n")
                if file and file != "??" and line > 0:
                    out.write(f"  {file}:{line}{'' if outermost else ' (inlined)'}\n")
        out.write("\n")


main()
