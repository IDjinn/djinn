import json
import os
import subprocess
import time


class Client:
    def __init__(self, exe, cwd=None):
        self.proc = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd)
        self.next_id = 1
        self.notifications = []

    def send(self, payload):
        body = json.dumps(payload).encode("utf-8")
        self.proc.stdin.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
        self.proc.stdin.flush()

    def read_message(self):
        length = None
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise EOFError("server closed the stream")
            line = line.strip()
            if not line:
                break
            if line.lower().startswith(b"content-length:"):
                length = int(line.split(b":")[1])
        return json.loads(self.proc.stdout.read(length).decode("utf-8"))

    def request(self, method, params):
        identifier = self.next_id
        self.next_id += 1
        self.send({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params})
        while True:
            message = self.read_message()
            if message.get("id") == identifier and "method" not in message:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result")
            self.notifications.append(message)

    def notify(self, method, params):
        self.send({"jsonrpc": "2.0", "method": method, "params": params})

    def wait_for(self, method, predicate=lambda p: True, timeout=20):
        deadline = time.time() + timeout
        for index, message in enumerate(self.notifications):
            if message.get("method") == method and predicate(message["params"]):
                del self.notifications[index]
                return message["params"]
        while time.time() < deadline:
            message = self.read_message()
            if message.get("method") == method and predicate(message["params"]):
                return message["params"]
            self.notifications.append(message)
        raise TimeoutError(method)

    def close(self):
        try:
            self.request("shutdown", None)
            self.notify("exit", None)
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


def uri_of(path):
    path = os.path.abspath(path).replace("\\", "/")
    if path[1:2] == ":":
        path = "/" + path
    return "file://" + path
