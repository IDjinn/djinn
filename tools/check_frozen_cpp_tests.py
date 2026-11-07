#!/usr/bin/env python3
"""Fails when a C++ test is added under tests/. New tests are written in Djinn, in tests/conformance.

The manifest tests/frozen_cpp_tests.txt lists each frozen file and how many TEST cases it holds. A file may lose cases (they
were migrated) but never gain any, and no file may appear that is not in the manifest.

usage: check_frozen_cpp_tests.py [--update]
--update rewrites the manifest from the tree; use it only after migrating or deleting tests.
"""
import glob
import os
import re
import sys

MANIFEST = "tests/frozen_cpp_tests.txt"
CASE = re.compile(r"^[ ]*TEST(?:_F|_P)?[(]", re.M)


def current():
    found = {}
    for path in sorted(glob.glob("tests/**/*.cpp", recursive=True)):
        with open(path, encoding="utf-8", errors="replace") as stream:
            found[path.replace(os.sep, "/")] = len(CASE.findall(stream.read()))
    return found


def frozen():
    entries = {}
    with open(MANIFEST, encoding="utf-8") as stream:
        for line in stream:
            if line.strip() and not line.startswith("#"):
                path, count = line.split()
                entries[path] = int(count)
    return entries


def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    os.chdir(root)
    tree = current()
    if "--update" in sys.argv:
        with open(MANIFEST, "w", encoding="utf-8", newline="\n") as stream:
            stream.write("# Frozen C++ tests: path and number of TEST cases. New tests go in tests/conformance, in Djinn.\n")
            stream.writelines("%s %d\n" % item for item in tree.items())
        return 0
    allowed = frozen()
    problems = []
    for path, count in tree.items():
        if path not in allowed:
            problems.append("%s is a new C++ test file; write the test in Djinn under tests/conformance" % path)
        elif count > allowed[path]:
            problems.append("%s has %d TEST cases, %d are frozen; write the new ones in Djinn" % (path, count, allowed[path]))
    for problem in problems:
        print(problem)
    if problems:
        return 1
    print("frozen C++ tests: %d files, %d cases" % (len(tree), sum(tree.values())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
